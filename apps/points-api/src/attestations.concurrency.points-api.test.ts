// @vitest-environment node
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { dbFromPool, type Db } from "./db";
import { createGithubClient } from "./github";
import { migrate } from "./migrate";
import { admitInstall } from "./test-db";
import { COMMIT, TEST_REPO, fakeGithub, functionsOf, surfaceFilesFor } from "./test-github";
import { attestBody, createTestDevice, createTestWallet, leaveBody, registerBody, type TestWallet } from "./test-signers";

/**
 * PGlite is one connection, so it can't show the races the scan code guards
 * against: the per-release advisory lock, the challenge's FOR UPDATE and the
 * wallet's FOR SHARE. These run against a real server, only when
 * TEST_DATABASE_URL names one (CI provides it), each on its own schema.
 */
const URL = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-08T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;

interface Challenge {
  challenge: string;
  release: string;
  commit: string;
  functions: { file: string; symbol: string }[];
}

let admin: pg.Pool;
let wallets: TestWallet[];
const pools: pg.Pool[] = [];
/** Side connections still holding a lock; freed after a failed wait so the pool can close. */
const heldClients: pg.PoolClient[] = [];
let schemaCounter = 0;

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: URL, max: 1 });
  wallets = await Promise.all([createTestWallet(), createTestWallet(), createTestWallet()]);
}, 90_000);

afterEach(async () => {
  for (const client of heldClients.splice(0)) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await admin?.end();
});

async function setup() {
  const schema = `race_${process.pid}_${schemaCounter++}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  // Every pooled connection must see the same schema; the pool is the
  // "two connections" the races need.
  const pool = new pg.Pool({ connectionString: URL, max: 8, options: `-c search_path=${schema}` });
  pools.push(pool);
  const db: Db = dbFromPool(pool);
  await migrate(db);

  const files = surfaceFilesFor();
  const github = createGithubClient({
    fetchImpl: fakeGithub({ "1.0.0": { commit: COMMIT, files } }, "v1.0.0").fetch,
    repo: TEST_REPO,
    now: () => NOW.getTime(),
  });
  const app = createApp({ db, now: () => NOW, newInviteCode: () => Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, "0"), github });

  const post = async (path: string, body: unknown) => {
    const response = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as { code?: string } };
  };
  const register = async (wallet: TestWallet) => {
    const device = await createTestDevice();
    await admitInstall(db, device);
    await post("/register", await registerBody(wallet, device, { issuedAt: NOW_SECONDS }));
  };
  const challenge = async () => (await (await app.request("/scan/challenge", { headers: { "x-forwarded-for": "10.0.0.1" } })).json()) as Challenge;
  const attestation = (c: Challenge) => {
    const spans = functionsOf(files);
    return {
      release: c.release,
      commit: c.commit,
      model: "claude-opus-5-5",
      challenge: c.challenge,
      answers: c.functions.map((fn) => ({
        file: fn.file,
        symbol: fn.symbol,
        line: spans.find((span) => span.file === fn.file && span.symbol === fn.symbol)!.startLine + 1,
        check: "Rejects a falsy value before it is used",
      })),
      result: "pass",
      report: "Read the surface files and ran the tests.",
    };
  };
  const count = async (table: string) => Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]!.n);
  return { pool, db, post, register, challenge, attestation, count };
}

/**
 * Holds a lock from a side connection so the submits under test must queue
 * behind it. Polling pg_stat_activity until they do makes each interleaving
 * certain rather than a matter of timing; if the code under test stopped
 * taking the lock, no one would wait and the poll fails.
 */
async function holdLock(s: Awaited<ReturnType<typeof setup>>, lockSql: string, params: unknown[] = []) {
  const side = await s.pool.connect();
  heldClients.push(side);
  await side.query("BEGIN");
  await side.query(lockSql, params);
  return {
    release: async () => {
      await side.query("COMMIT");
      heldClients.splice(heldClients.indexOf(side), 1);
      side.release();
    },
  };
}

async function waitForWaiters(s: Awaited<ReturnType<typeof setup>>, queryLike: string, expected: number) {
  const deadline = Date.now() + 10_000;
  let waiting = 0;
  while (Date.now() < deadline) {
    const { rows } = await s.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1",
      [queryLike],
    );
    waiting = Number(rows[0]!.n);
    if (waiting >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${expected} connections waiting on "${queryLike}", saw ${waiting}.`);
}

describe.skipIf(!URL)("scan submits on a real Postgres", () => {
  it("queues concurrent submits on the release's advisory lock so exactly one wins a shared challenge", async () => {
    const s = await setup();
    await s.register(wallets[0]!);
    await s.register(wallets[1]!);
    const attestation = s.attestation(await s.challenge());
    const bodies = [await attestBody(wallets[0]!, attestation), await attestBody(wallets[1]!, attestation)];
    const held = await holdLock(s, "SELECT pg_advisory_xact_lock(hashtext($1))", ["attest:1.0.0"]);

    const submits = bodies.map((body) => s.post("/attestations", body));
    await waitForWaiters(s, "%pg_advisory_xact_lock%", 2);
    await held.release();
    const results = await Promise.all(submits);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.json.code).toBe("challenge_used");
    expect(await s.count("attestations")).toBe(1);
  });

  it("makes a submit wait on its challenge row, then see it used", async () => {
    const s = await setup();
    await s.register(wallets[0]!);
    await s.register(wallets[1]!);
    const challenge = await s.challenge();
    const attestation = s.attestation(challenge);
    const bodies = [await attestBody(wallets[0]!, attestation), await attestBody(wallets[1]!, attestation)];
    const held = await holdLock(s, "SELECT 1 FROM challenges WHERE id = $1 FOR UPDATE", [challenge.challenge]);

    const first = s.post("/attestations", bodies[0]);
    await waitForWaiters(s, "%FROM challenges WHERE id = $1 FOR UPDATE%", 1);
    const second = s.post("/attestations", bodies[1]);
    await waitForWaiters(s, "%pg_advisory_xact_lock%", 1);
    await held.release();
    const results = await Promise.all([first, second]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await s.count("attestations")).toBe(1);
  });

  it("makes a submit wait for a leave in flight and then refuse, instead of crediting a deleted wallet", async () => {
    const s = await setup();
    await s.register(wallets[2]!);
    const attest = await attestBody(wallets[2]!, s.attestation(await s.challenge()));
    const held = await holdLock(s, "DELETE FROM wallets WHERE address = $1", [wallets[2]!.address]);

    const submit = s.post("/attestations", attest);
    await waitForWaiters(s, "%FROM wallets WHERE address = $1 FOR SHARE%", 1);
    await held.release();
    const result = await submit;

    expect(result.status).toBe(403);
    expect(result.json.code).toBe("wallet_not_registered");
    expect(await s.count("attestations")).toBe(0);
    expect(await s.count("scan_points")).toBe(0);
  });

  it("lets a leave and a submit race without a constraint error whichever commits first", async () => {
    for (let round = 0; round < 8; round++) {
      const s = await setup();
      await s.register(wallets[2]!);
      const attest = await attestBody(wallets[2]!, s.attestation(await s.challenge()));
      const leave = await leaveBody(wallets[2]!, NOW_SECONDS);

      const [attested, left] = await Promise.all([s.post("/attestations", attest), s.post("/leave", leave)]);

      expect(left.status).toBe(200);
      expect([200, 403]).toContain(attested.status);
      expect(await s.count("wallets")).toBe(0);
      expect(await s.count("scan_points")).toBe(0);
    }
  });
});
