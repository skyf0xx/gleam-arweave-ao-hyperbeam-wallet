// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Db } from "../db";
import { createGithubClient } from "./github";
import { admitInstall, createTestDb } from "../testing/test-db";
import { COMMIT, TEST_REPO, areaFilesFor, fakeGithub, functionsOf, surfaceFilesFor } from "../testing/test-github";
import { attestBody, createTestDevice, createTestWallet, leaveBody, registerBody, type TestWallet } from "../testing/test-signers";

const NOW = new Date("2026-10-08T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const CHECK = "Rejects a falsy value before it is used";

let alice: TestWallet;
let bob: TestWallet;
let carol: TestWallet;

beforeAll(async () => {
  [alice, bob, carol] = await Promise.all([createTestWallet(), createTestWallet(), createTestWallet()]);
}, 90_000);

interface Challenge {
  challenge: string;
  release: string;
  commit: string;
  area?: string;
  functions: { file: string; symbol: string }[];
  expiresAt?: string;
}

interface Json {
  ok: boolean;
  code: string;
  error: string;
  issues: { code: string; path: string; message: string }[];
  challenge: string;
  release: string;
  commit: string;
  functions: { file: string; symbol: string }[];
  attestationId: string;
  message: string;
  points: string;
  paid: boolean;
  paidPlacesLeft: number;
  coverage: {
    examined: number;
    total: number;
    unexamined: { file: string; symbol: string }[];
    byArea: { id: string; label: string; examined: number; total: number }[] | null;
  };
  attestations: { id: string; proof: string; signature: string; area: string | null; round: number | null }[];
  [key: string]: unknown;
}

async function setup(options: { latest?: string | null; files?: Record<string, string> } = {}) {
  const db = await createTestDb();
  const files = options.files ?? surfaceFilesFor();
  const github = fakeGithub({ "1.0.0": { commit: COMMIT, files } }, options.latest === undefined ? "v1.0.0" : options.latest);
  let clock = NOW.getTime();
  const client = createGithubClient({ fetchImpl: github.fetch, repo: TEST_REPO, now: () => clock });
  const codes = ["ALICE001", "BOB00002", "CAROL003"];
  const app = createApp({ db, now: () => new Date(clock), newInviteCode: () => codes.shift()!, github: client });

  const request = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const post = async (path: string, body: unknown) => {
    const response = await request("POST", path, body);
    return { status: response.status, json: (await response.json()) as Json };
  };
  const get = async (path: string) => {
    const response = await request("GET", path);
    return { status: response.status, json: (await response.json()) as Json, headers: response.headers };
  };
  const register = async (wallet: TestWallet) => {
    const device = await createTestDevice();
    await admitInstall(db, device);
    await post("/register", await registerBody(wallet, device, { issuedAt: NOW_SECONDS }));
  };
  const challenge = async (area?: string) => (await get(area ? `/scan/challenge?area=${area}` : "/scan/challenge")).json as Challenge;

  const advance = (ms: number) => (clock += ms);

  return { db, app, files, github, post, get, register, challenge, advance };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** A correct attestation for `challenge`: each answer cites the first line of the function's body. */
function attestationFor(s: Setup, challenge: Challenge, overrides: Record<string, unknown> = {}) {
  const spans = functionsOf(s.files);
  return {
    release: challenge.release,
    commit: challenge.commit,
    model: "claude-opus-5-5",
    challenge: challenge.challenge,
    answers: challenge.functions.map((fn) => ({
      file: fn.file,
      symbol: fn.symbol,
      line: spans.find((span) => span.file === fn.file && span.symbol === fn.symbol)!.startLine + 1,
      check: CHECK,
    })),
    result: "pass",
    report: "Read the surface files and ran the tests.",
    ...overrides,
  };
}

async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`, params);
  return Number(rows[0]!.n);
}

/** Holding points of 3,000,000 and 7,000,000 on 2026-10-07, so a scan earns 10,000. */
async function creditPreviousDay(db: Db) {
  await db.query("INSERT INTO snapshot_runs (day, completed_at, wallet_count, failed_count) VALUES ('2026-10-07', now(), 2, 0), ('2026-10-06', now(), 2, 0)");
  for (const [day, address, holding] of [
    ["2026-10-07", alice.address, "3000000"],
    ["2026-10-07", bob.address, "7000000"],
    ["2026-10-06", alice.address, "99000000"],
  ] as const) {
    await db.query(
      "INSERT INTO points (day, address, holding_atomic, referee_bonus_atomic, referrer_bonus_atomic) VALUES ($1, $2, $3, 0, 0)",
      [day, address, holding],
    );
  }
}

/** Opens 100 paid places on the release, as one scanned before places followed coverage did, and fills `n` of them with attestations by wallets that don't exist. */
async function fillPaidPlaces(db: Db, release: string, n: number, commit = COMMIT) {
  await db.query("INSERT INTO scan_releases (release, paid_places, created_at) VALUES ($1, 100, now()) ON CONFLICT DO NOTHING", [release]);
  for (let i = 0; i < n; i++) {
    await db.query(
      "INSERT INTO challenges (id, release, commit, functions, created_at, expires_at) VALUES ($1, $2, $3, '[]', now(), now())",
      [`filler-${release}-${i}`, release, commit],
    );
    await db.query(
      `INSERT INTO attestations (id, release, commit, challenge_id, address, owner, signature, proof, message, body, paid, created_at)
       VALUES ($1, $2, $3, $4, $5, 'o', 's', 'message', 'm', $6, true, now())`,
      [`${release === "1.0.0" ? "" : "f"}${i}`.padStart(64, "0"), release, commit, `filler-${release}-${i}`, `filler-${i}`, JSON.stringify({ model: "x", result: "pass", report: "r", answers: [] })],
    );
  }
}

describe("GET /scan/challenge", () => {
  it("issues three functions of one area at the latest release's commit and stores the challenge", async () => {
    const s = await setup();
    const { status, json } = await s.get("/scan/challenge");

    // src/a.ts alone is too few functions for the keys area, so lib/ (signing) is drawn from.
    expect(status).toBe(200);
    expect(json).toMatchObject({ release: "1.0.0", commit: COMMIT, area: "signing", expiresAt: "2026-10-11T12:00:00.000Z" });
    expect(json.challenge).toMatch(/^[A-Za-z0-9_-]{22,43}$/);
    expect(json.functions).toHaveLength(3);
    const known = functionsOf(s.files).filter((fn) => fn.area === "signing").map((fn) => `${fn.file}:${fn.symbol}`);
    for (const fn of json.functions) expect(known).toContain(`${fn.file}:${fn.symbol}`);
    expect(new Set(json.functions.map((fn: { file: string }) => fn.file)).size).toBe(2);

    const { rows } = await s.db.query<{ release: string; commit: string; used_by_attestation: string | null; area: string }>(
      "SELECT release, commit, used_by_attestation, area FROM challenges WHERE id = $1",
      [json.challenge],
    );
    expect(rows[0]).toEqual({ release: "1.0.0", commit: COMMIT, used_by_attestation: null, area: "signing" });
  });

  it("gives each request its own challenge", async () => {
    const s = await setup();
    expect((await s.challenge()).challenge).not.toBe((await s.challenge()).challenge);
  });

  it("says there is no release yet", async () => {
    const s = await setup({ latest: null });
    const { status, json } = await s.get("/scan/challenge");

    expect(status).toBe(404);
    expect(json).toMatchObject({ code: "no_release", error: expect.stringContaining("try again once a release is published") });
    expect(json).not.toHaveProperty("ok");
  });

  it("answers 503 with Retry-After when GitHub is down, and retries after a minute", async () => {
    const s = await setup();
    s.github.failWith = 500;
    const failed = await s.get("/scan/challenge");
    s.github.failWith = null;

    expect(failed.status).toBe(503);
    expect(failed.headers.get("retry-after")).toBe("60");
    expect(failed.json.code).toBe("github_unavailable");
    expect(failed.json).not.toHaveProperty("ok");
    expect((await s.get("/scan/challenge")).status).toBe(503);
    s.advance(60_000);
    expect((await s.get("/scan/challenge")).status).toBe(200);
  });

  it("is limited to 30 an hour per IP", async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) expect((await s.get("/scan/challenge")).status).toBe(200);

    const response = await s.app.request("/scan/challenge", { headers: { "x-forwarded-for": "10.0.0.1" } });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(await response.json()).toEqual({
      error: "Too many scan requests from this address; try again in about 60 minutes.",
      code: "rate_limited",
    });
  });

  it("drops unused challenges a day after they expire", async () => {
    const s = await setup();
    await s.db.query(
      "INSERT INTO challenges (id, release, commit, functions, created_at, expires_at) VALUES ('old', '1.0.0', $1, '[]', '2026-10-01', '2026-10-02')",
      [COMMIT],
    );
    await s.challenge();
    expect(await count(s.db, "challenges WHERE id = 'old'")).toBe(0);
  });
});

describe("POST /attestations", () => {
  it("credits 0.1% of the previous day's holding points and marks the challenge used", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    const challenge = await s.challenge();
    const attestation = attestationFor(s, challenge);

    const { status, json } = await s.post("/attestations", await attestBody(alice, attestation));

    expect(status).toBe(200);
    // Six functions, none examined: two places.
    expect(json).toMatchObject({ ok: true, points: "10000", paid: true, unpaidReason: null, paidPlacesLeft: 49, paidScans: 1 });
    expect(json.attestationId).toMatch(/^[0-9a-f]{64}$/);
    const { rows } = await s.db.query<{ address: string; kind: string; amount_atomic: string; attestation_id: string }>(
      "SELECT address, kind, amount_atomic::text, attestation_id FROM scan_points",
    );
    expect(rows).toEqual([{ address: alice.address, kind: "scan", amount_atomic: "10000", attestation_id: json.attestationId }]);
    const stored = await s.db.query<{ address: string; paid: boolean; challenge_id: string; proof: string }>(
      "SELECT address, paid, challenge_id, proof FROM attestations",
    );
    expect(stored.rows).toEqual([{ address: alice.address, paid: true, challenge_id: challenge.challenge, proof: "message" }]);
    const used = await s.db.query<{ used_by_attestation: string }>("SELECT used_by_attestation FROM challenges WHERE id = $1", [challenge.challenge]);
    expect(used.rows[0]?.used_by_attestation).toBe(json.attestationId);
    // Each answered function is kept with the hash of its text, so later releases can count it.
    const examined = await s.db.query<{ attestation_id: string; file: string; symbol: string; fingerprint: string }>(
      "SELECT attestation_id, file, symbol, fingerprint FROM examined_functions ORDER BY file, symbol",
    );
    const spans = functionsOf(s.files);
    expect(examined.rows).toEqual(
      [...challenge.functions]
        .sort((x, y) => (`${x.file}\n${x.symbol}` < `${y.file}\n${y.symbol}` ? -1 : 1))
        .map((fn) => ({
          attestation_id: json.attestationId,
          file: fn.file,
          symbol: fn.symbol,
          fingerprint: spans.find((span) => span.file === fn.file && span.symbol === fn.symbol)!.fingerprint,
        })),
    );
  });

  it("truncates the reward to whole atomic units", async () => {
    const s = await setup();
    await s.register(alice);
    await s.db.query("INSERT INTO snapshot_runs (day, completed_at, wallet_count, failed_count) VALUES ('2026-10-07', now(), 1, 0)");
    await s.db.query("INSERT INTO points (day, address, holding_atomic, referee_bonus_atomic, referrer_bonus_atomic) VALUES ('2026-10-07', $1, 1999, 0, 0)", [alice.address]);

    const { json } = await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    expect(json.points).toBe("1");
  });

  it("accepts a scan before any snapshot day exists, crediting nothing and using no paid place", async () => {
    const s = await setup();
    await s.register(alice);
    // Today's own snapshot isn't "the previous day".
    await s.db.query("INSERT INTO snapshot_runs (day, completed_at, wallet_count, failed_count) VALUES ('2026-10-08', now(), 1, 0)");
    await s.db.query("INSERT INTO points (day, address, holding_atomic, referee_bonus_atomic, referrer_bonus_atomic) VALUES ('2026-10-08', $1, 5000000, 0, 0)", [alice.address]);

    const { status, json } = await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));

    expect(status).toBe(200);
    expect(json).toMatchObject({ points: "0", paid: false, unpaidReason: "no_snapshot", paidPlacesLeft: 50, paidScans: 0 });
    expect(await count(s.db, "attestations")).toBe(1);
    expect(await count(s.db, "scan_points")).toBe(0);
    expect((await s.get("/attestations")).json.attestations[0]).toMatchObject({ paid: false, unpaidReason: "no_snapshot" });
  });

  it("accepts a hardware wallet's ownership transaction as the proof", async () => {
    const s = await setup();
    await s.register(alice);
    const attestation = attestationFor(s, await s.challenge());

    const { status } = await s.post("/attestations", await attestBody(alice, attestation, { proof: "transaction" }));

    expect(status).toBe(200);
    const { rows } = await s.db.query<{ proof: string }>("SELECT proof FROM attestations");
    expect(rows[0]?.proof).toBe("transaction");
  });

  it("accepts the longest report", async () => {
    const s = await setup();
    await s.register(alice);
    const attestation = attestationFor(s, await s.challenge(), { report: "r".repeat(20_000) });
    expect((await s.post("/attestations", await attestBody(alice, attestation))).status).toBe(200);
  });

  it("records a scan past the paid places with no points", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    await fillPaidPlaces(s.db, "1.0.0", 100);

    const { status, json } = await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));

    expect(status).toBe(200);
    expect(json).toMatchObject({ points: "0", paid: false, unpaidReason: "places_taken", paidPlacesLeft: 0 });
    expect(await count(s.db, "attestations WHERE address = $1 AND NOT paid", [alice.address])).toBe(1);
    expect(await count(s.db, "scan_points")).toBe(0);
  });

  it("pays every paid place the same reward", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    await fillPaidPlaces(s.db, "1.0.0", 19);

    const last = await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    const after = await s.post("/attestations", await attestBody(bob, attestationFor(s, await s.challenge())));

    expect(last.json).toMatchObject({ paid: true, points: "10000", paidPlacesLeft: 80, paidScans: 20 });
    expect(after.json).toMatchObject({ paid: true, points: "10000", paidPlacesLeft: 79, paidScans: 21 });
  });

  it("pays the 100th place and not the 101st", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    await fillPaidPlaces(s.db, "1.0.0", 99);

    const last = await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    const after = await s.post("/attestations", await attestBody(bob, attestationFor(s, await s.challenge())));

    expect(last.json).toMatchObject({ paid: true, paidPlacesLeft: 0 });
    expect(after.json).toMatchObject({ paid: false, points: "0" });
  });

  it("frees a paid place when an attestation is voided", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    await fillPaidPlaces(s.db, "1.0.0", 100);
    await s.db.query("UPDATE attestations SET voided_at = now() WHERE address = 'filler-0'");

    const { json } = await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    expect(json.paid).toBe(true);
  });

  describe("refusals", () => {
    async function ready() {
      const s = await setup();
      await s.register(alice);
      const challenge = await s.challenge();
      return { s, challenge, attestation: attestationFor(s, challenge) };
    }
    async function refused(s: Setup, body: unknown) {
      const before = await count(s.db, "attestations");
      const { status, json } = await s.post("/attestations", body);
      expect(await count(s.db, "attestations")).toBe(before);
      expect(await count(s.db, "scan_points")).toBe(0);
      expect(json.error).toEqual(expect.any(String));
      return { status, json };
    }

    it("400 malformed_request for a body that isn't a request", async () => {
      const { s } = await ready();
      expect((await refused(s, { attestation: {} , owner: 1 })).json.code).toBe("malformed_request");
      expect((await refused(s, null)).json.code).toBe("malformed_request");
    });

    it("400 invalid_attestation with every issue", async () => {
      const { s, attestation } = await ready();
      const bad = { ...attestation, model: "", result: "maybe" };
      const body = { ...(await attestBody(alice, attestation)), attestation: bad };

      const { status, json } = await refused(s, body);
      expect(status).toBe(400);
      expect(json.code).toBe("invalid_attestation");
      expect(json.issues.map((i: { path: string }) => i.path)).toEqual(["model", "result"]);
    });

    it("400 message_mismatch when the signed message is for another attestation", async () => {
      const { s, attestation } = await ready();
      const other = await attestBody(alice, { ...attestation, report: "A different report." });
      const body = { ...(await attestBody(alice, attestation)), message: other.message, signature: other.signature };

      const { status, json } = await refused(s, body);
      expect(status).toBe(400);
      expect(json.code).toBe("message_mismatch");
    });

    it("401 invalid_signature for a signature by another wallet or the wrong proof kind", async () => {
      const { s, attestation } = await ready();
      const byBob = await attestBody(bob, attestation);
      expect((await refused(s, { ...byBob, owner: alice.signer.owner })).json.code).toBe("invalid_signature");

      const asMessage = await attestBody(alice, attestation, { proof: "transaction" });
      const withoutProof = { ...asMessage, proof: undefined };
      expect((await refused(s, withoutProof)).json.code).toBe("invalid_signature");
    });

    it("403 wallet_not_registered", async () => {
      const { s, attestation } = await ready();
      const { status, json } = await refused(s, await attestBody(carol, attestation));
      expect(status).toBe(403);
      expect(json.code).toBe("wallet_not_registered");
      expect(json.error).toContain("register it in Gleam");
    });

    it("403 wallet_not_live when the install hasn't checked in for 3 days", async () => {
      const { s, attestation } = await ready();
      await s.db.query("UPDATE devices SET last_heartbeat_at = $1", [new Date(NOW.getTime() - 3 * 86_400_000 - 1)]);
      const { status, json } = await refused(s, await attestBody(alice, attestation));
      expect(status).toBe(403);
      expect(json.code).toBe("wallet_not_live");
    });

    it("409 release_not_latest, telling the agent which release to check out", async () => {
      const { s, attestation } = await ready();
      const { status, json } = await refused(s, await attestBody(alice, { ...attestation, release: "0.9.0" }));
      expect(status).toBe(409);
      expect(json.code).toBe("release_not_latest");
      expect(json.error).toBe("v0.9.0 isn't the latest release (v1.0.0 is); check out v1.0.0 and run `pnpm scan start`.");
    });

    it("409 commit_mismatch", async () => {
      const { s, attestation } = await ready();
      const { json } = await refused(s, await attestBody(alice, { ...attestation, commit: "f".repeat(40) }));
      expect(json.code).toBe("commit_mismatch");
    });

    it("404 challenge_unknown", async () => {
      const { s, attestation } = await ready();
      const { status, json } = await refused(s, await attestBody(alice, { ...attestation, challenge: "A".repeat(32) }));
      expect(status).toBe(404);
      expect(json.code).toBe("challenge_unknown");
    });

    it("409 challenge_expired", async () => {
      const { s, challenge, attestation } = await ready();
      await s.db.query("UPDATE challenges SET expires_at = $2 WHERE id = $1", [challenge.challenge, NOW]);
      const { status, json } = await refused(s, await attestBody(alice, attestation));
      expect(status).toBe(409);
      expect(json.code).toBe("challenge_expired");
      expect(json.error).toBe("This challenge expired; run `pnpm scan start` for a new one.");
    });

    it("409 challenge_used when another wallet already used it", async () => {
      const s = await setup();
      await s.register(alice);
      await s.register(bob);
      const attestation = attestationFor(s, await s.challenge());
      expect((await s.post("/attestations", await attestBody(bob, attestation))).status).toBe(200);

      const { status, json } = await refused(s, await attestBody(alice, attestation));
      expect(status).toBe(409);
      expect(json.code).toBe("challenge_used");
    });

    it("409 challenge_wrong_commit when the tag has moved since the challenge", async () => {
      const { s, challenge, attestation } = await ready();
      await s.db.query("UPDATE challenges SET commit = $2 WHERE id = $1", [challenge.challenge, "e".repeat(40)]);
      const { status, json } = await refused(s, await attestBody(alice, attestation));
      expect(status).toBe(409);
      expect(json.code).toBe("challenge_wrong_commit");
      expect(json.error).toContain("run `pnpm scan start` again");
    });

    it("sets the code and status from the most fundamental of several issues", async () => {
      const { s, challenge, attestation } = await ready();
      await s.db.query("UPDATE challenges SET expires_at = $2, used_by_attestation = 'x' WHERE id = $1", [challenge.challenge, NOW]);
      const { status, json } = await refused(s, await attestBody(alice, { ...attestation, release: "0.9.0" }));
      expect([status, json.code]).toEqual([409, "release_not_latest"]);
      expect(json.issues.map((i: { code: string }) => i.code)).toEqual(["release_not_latest", "challenge_expired", "challenge_used", "challenge_wrong_release"]);

      const unknown = await refused(s, await attestBody(alice, { ...attestation, challenge: "A".repeat(32) }));
      expect([unknown.status, unknown.json.code]).toEqual([404, "challenge_unknown"]);
    });

    it("accepts a body well past the old 16 KB limit and refuses one past 160 KB", async () => {
      const { s, attestation } = await ready();
      const padded = { ...(await attestBody(alice, attestation)), padding: "x".repeat(150 * 1024) };
      expect((await s.post("/attestations", padded)).status).toBe(200);
      const response = await s.app.request("/attestations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(170 * 1024) }),
      });
      expect(response.status).toBe(413);
    });

    it("409 challenge_wrong_release", async () => {
      const { s, challenge, attestation } = await ready();
      await s.db.query("UPDATE challenges SET release = '0.9.0' WHERE id = $1", [challenge.challenge]);
      const { json } = await refused(s, await attestBody(alice, attestation));
      expect(json.code).toBe("challenge_wrong_release");
    });

    it("422 answers_failed with each failing answer", async () => {
      const { s, challenge, attestation } = await ready();
      const signature = functionsOf(s.files).find((fn) => fn.symbol === attestation.answers[0]!.symbol)!.startLine;
      const answers = [
        { ...attestation.answers[0]!, line: signature },
        { ...attestation.answers[1]!, line: 9999 },
        attestation.answers[2]!,
      ];
      const { status, json } = await refused(s, await attestBody(alice, { ...attestation, answers }));

      expect(status).toBe(422);
      expect(json.code).toBe("answers_failed");
      expect(json.issues.map((i: { code: string }) => i.code)).toEqual(["line-in-signature", "line-out-of-range"]);
      // The challenge survives a failed answer check, so the agent can fix it and sign again.
      const row = await s.db.query<{ used_by_attestation: string | null }>("SELECT used_by_attestation FROM challenges WHERE id = $1", [challenge.challenge]);
      expect(row.rows[0]?.used_by_attestation).toBeNull();
    });

    it("422 answers_failed for functions the challenge didn't name", async () => {
      const { s, attestation } = await ready();
      const answers = [{ ...attestation.answers[0]!, symbol: "plain" }, ...attestation.answers.slice(1)];
      const { json } = await refused(s, await attestBody(alice, { ...attestation, answers }));
      expect(json.issues.map((i: { code: string }) => i.code)).toEqual(["answer-not-in-challenge", "challenge-function-unanswered"]);
    });

    it("409 already_attested for a second scan of the same release", async () => {
      const { s, attestation } = await ready();
      expect((await s.post("/attestations", await attestBody(alice, attestation))).status).toBe(200);

      const second = attestationFor(s, await s.challenge());
      const { status, json } = await s.post("/attestations", await attestBody(alice, second));
      expect(status).toBe(409);
      expect(json.code).toBe("already_attested");
      expect(await count(s.db, "attestations")).toBe(1);
    });

    it("checks in order: the signature before the release, the release before the challenge", async () => {
      const { s, attestation } = await ready();
      const stale = { ...attestation, release: "0.9.0", challenge: "A".repeat(32) };
      const unregistered = await refused(s, await attestBody(carol, stale));
      expect(unregistered.json.code).toBe("wallet_not_registered");
      const registered = await refused(s, await attestBody(alice, stale));
      expect(registered.json.code).toBe("release_not_latest");
      // The status follows a fixed precedence, not the order the issues were found in.
      expect(registered.status).toBe(409);
      expect(registered.json.issues.map((i: { code: string }) => i.code)).toEqual(["release_not_latest", "challenge_unknown"]);
    });

    it("404 no_release when none exists", async () => {
      const s = await setup({ latest: null });
      await s.register(alice);
      const challenge = { challenge: "A".repeat(32), release: "1.0.0", commit: COMMIT, functions: [] };
      const attestation = { ...attestationFor(s, challenge), answers: attestationFor(s, { ...challenge, functions: functionsOf(s.files).slice(0, 3) }).answers };
      const { status, json } = await refused(s, await attestBody(alice, attestation));
      expect(status).toBe(404);
      expect(json.code).toBe("no_release");
    });

    it("503 github_unavailable, leaving the challenge usable", async () => {
      const { s, challenge, attestation } = await ready();
      const body = await attestBody(alice, attestation);
      s.github.failWith = 503;
      s.github.calls.length = 0;
      // Cached files from issuing the challenge would hide the outage, so use a fresh client.
      const fresh = createApp({ db: s.db, now: () => NOW, github: createGithubClient({ fetchImpl: s.github.fetch, repo: TEST_REPO }) });
      const failed = await fresh.request("/attestations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(failed.status).toBe(503);
      expect(failed.headers.get("retry-after")).toBe("60");
      expect((await failed.json() as { code: string }).code).toBe("github_unavailable");

      s.github.failWith = null;
      expect((await s.post("/attestations", body)).status).toBe(200);
      expect(challenge.challenge).toBeTruthy();
    });
  });

  describe("races", () => {
    it("lets one of two wallets use a challenge", async () => {
      const s = await setup();
      await s.register(alice);
      await s.register(bob);
      const attestation = attestationFor(s, await s.challenge());

      const [a, b] = await Promise.all([
        s.post("/attestations", await attestBody(alice, attestation)),
        s.post("/attestations", await attestBody(bob, attestation)),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect([a, b].find((r) => r.status === 409)?.json.code).toBe("challenge_used");
      expect(await count(s.db, "attestations")).toBe(1);
      expect(await count(s.db, "scan_points")).toBe(0);
    });

    it("lets a wallet attest a release once even from two challenges at once", async () => {
      const s = await setup();
      await s.register(alice);
      const first = attestationFor(s, await s.challenge());
      const second = attestationFor(s, await s.challenge());

      const [a, b] = await Promise.all([
        s.post("/attestations", await attestBody(alice, first)),
        s.post("/attestations", await attestBody(alice, second)),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect([a, b].find((r) => r.status === 409)?.json.code).toBe("already_attested");
      expect(await count(s.db, "attestations")).toBe(1);
      // The refused attempt's challenge stays unused.
      expect(await count(s.db, "challenges WHERE used_by_attestation IS NOT NULL")).toBe(1);
    });

    it("pays only one of two scans racing for the last place", async () => {
      const s = await setup();
      await s.register(alice);
      await s.register(bob);
      await creditPreviousDay(s.db);
      await fillPaidPlaces(s.db, "1.0.0", 99);
      const forAlice = attestationFor(s, await s.challenge());
      const forBob = attestationFor(s, await s.challenge());

      const results = await Promise.all([
        s.post("/attestations", await attestBody(alice, forAlice)),
        s.post("/attestations", await attestBody(bob, forBob)),
      ]);

      expect(results.map((r) => r.json.paid).sort()).toEqual([false, true]);
      expect(await count(s.db, "attestations WHERE paid")).toBe(100);
    });
  });

  it("answers a retry of the same submission with the original result", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    const body = await attestBody(alice, attestationFor(s, await s.challenge()));

    const first = await s.post("/attestations", body);
    const retry = await s.post("/attestations", body);

    expect(retry.status).toBe(200);
    expect(retry.json).toEqual(first.json);
    expect(await count(s.db, "attestations")).toBe(1);
    expect(await count(s.db, "scan_points")).toBe(1);
  });

  it("is limited to 20 an hour per IP", async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++) expect((await s.post("/attestations", { attestation: {} })).status).toBe(400);
    const { status, json } = await s.post("/attestations", { attestation: {} });
    expect(status).toBe(429);
    expect(json.code).toBe("rate_limited");
  });
});

describe("POST /attestations/check", () => {
  it("passes a correct attestation without using the challenge", async () => {
    const s = await setup();
    const challenge = await s.challenge();
    const attestation = attestationFor(s, challenge);

    const first = await s.post("/attestations/check", { attestation });
    const again = await s.post("/attestations/check", { attestation });

    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true, paidPlacesLeft: 50, paidScans: 0 });
    expect(first.json.message).toBe(`gleam-points:attest:v1:1.0.0:${first.json.attestationId}`);
    expect(again.json).toEqual(first.json);
    expect(await count(s.db, "challenges WHERE used_by_attestation IS NOT NULL")).toBe(0);

    // The id it reports is the one the signed submission gets.
    await s.register(alice);
    const real = await s.post("/attestations", await attestBody(alice, attestation));
    expect(real.json.attestationId).toBe(first.json.attestationId);
  });

  it("reports paid places left", async () => {
    const s = await setup();
    await fillPaidPlaces(s.db, "1.0.0", 7);
    const { json } = await s.post("/attestations/check", { attestation: attestationFor(s, await s.challenge()) });
    expect(json.paidPlacesLeft).toBe(93);
  });

  it("gives the same issues as the real submission for every check the signer doesn't affect", async () => {
    const s = await setup();
    await s.register(alice);
    const challenge = await s.challenge();
    const good = attestationFor(s, challenge);
    const expired = await s.challenge();
    await s.db.query("UPDATE challenges SET expires_at = $2 WHERE id = $1", [expired.challenge, NOW]);
    const cases: Record<string, unknown> = {
      invalid_attestation: { ...good, model: "", result: "maybe" },
      release_not_latest: { ...good, release: "0.9.0" },
      commit_mismatch: { ...good, commit: "f".repeat(40) },
      challenge_unknown: { ...good, challenge: "A".repeat(32) },
      challenge_expired: attestationFor(s, expired),
      answers_failed: { ...good, answers: good.answers.map((a, i) => ({ ...a, line: i === 0 ? 9999 : a.line })) },
    };

    for (const [code, attestation] of Object.entries(cases)) {
      const dry = await s.post("/attestations/check", { attestation });
      const real = await s.post("/attestations", await attestBody(alice, attestation).catch(() => ({ attestation, owner: alice.signer.owner, message: "x", signature: "x" })));
      expect(dry.json, code).not.toHaveProperty("ok");
      expect(dry.json.code, code).toBe(code);
      expect(dry.status, code).toBe(real.status);
      expect(dry.json.issues, code).toEqual(real.json.issues);
      expect(dry.json.issues.length, code).toBeGreaterThan(0);
    }
  });

  it("says a used challenge is used", async () => {
    const s = await setup();
    await s.register(alice);
    const attestation = attestationFor(s, await s.challenge());
    await s.post("/attestations", await attestBody(alice, attestation));

    const { status, json } = await s.post("/attestations/check", { attestation });
    expect(status).toBe(409);
    expect(json.code).toBe("challenge_used");
  });

  it("reports already_attested up front when it is given the wallet's address", async () => {
    const s = await setup();
    await s.register(alice);
    await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    const next = attestationFor(s, await s.challenge());

    const named = await s.post("/attestations/check", { attestation: next, address: alice.address });
    expect(named.status).toBe(409);
    expect(named.json.code).toBe("already_attested");

    expect((await s.post("/attestations/check", { attestation: next, address: bob.address })).status).toBe(200);
    expect((await s.post("/attestations/check", { attestation: next })).status).toBe(200);
    expect((await s.post("/attestations/check", { attestation: next, address: "not an address!" })).status).toBe(400);
  });

  it("answers no_release when none exists", async () => {
    const s = await setup({ latest: null });
    const spans = functionsOf(s.files).slice(0, 3);
    const attestation = attestationFor(s, { challenge: "A".repeat(32), release: "1.0.0", commit: COMMIT, functions: spans, expiresAt: "" });
    const { status, json } = await s.post("/attestations/check", { attestation });
    expect(status).toBe(404);
    expect(json).toMatchObject({ code: "no_release" });
    expect(json).not.toHaveProperty("ok");
  });

  it("400 malformed_request without an attestation", async () => {
    const s = await setup();
    const { status, json } = await s.post("/attestations/check", {});
    expect(status).toBe(400);
    expect(json.code).toBe("malformed_request");
  });

  it("is limited to 120 an hour per IP", async () => {
    const s = await setup();
    for (let i = 0; i < 120; i++) await s.post("/attestations/check", {});
    expect((await s.post("/attestations/check", {})).status).toBe(429);
  });
});

describe("GET /attestations/count", () => {
  it("counts a release's non-voided scans and paid places left without reading GitHub again, and answers 0 for one with none", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    s.github.calls.length = 0;

    const latest = await s.get("/attestations/count?release=1.0.0");
    const none = await s.get("/attestations/count?release=0.5.0");

    expect(latest.json).toEqual({ release: "1.0.0", total: 1, paidPlacesLeft: 49, paidScans: 1 });
    expect(none.status).toBe(200);
    // Only the latest release can be scanned, so an older one never opened places.
    expect(none.json).toEqual({ release: "0.5.0", total: 0, paidPlacesLeft: 0, paidScans: 0 });
    expect(latest.headers.get("access-control-allow-origin")).toBe("*");
    expect(s.github.calls).toEqual([]);
  });

  it("400 for a missing or malformed release", async () => {
    const s = await setup();
    for (const query of ["", "?release=v1.0.0", "?release=x"]) {
      const { status, json } = await s.get(`/attestations/count${query}`);
      expect(status, query).toBe(400);
      expect(json.code).toBe("malformed_request");
    }
  });
});

describe("GET /attestations", () => {
  async function withScans() {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    const mine = attestationFor(s, await s.challenge(), { model: "model-a", report: "Alice's report." });
    const theirs = attestationFor(s, await s.challenge(), { model: "model-b", report: "Bob's report." });
    const a = await s.post("/attestations", await attestBody(alice, mine));
    const b = await s.post("/attestations", await attestBody(bob, theirs, { proof: "transaction" }));
    return { s, mine, theirs, a: a.json.attestationId as string, b: b.json.attestationId as string };
  }

  it("lists the latest release's attestations with what's needed to verify them, and coverage", async () => {
    const { s, mine, a, b } = await withScans();
    const { status, json, headers } = await s.get("/attestations");

    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("public, max-age=60");
    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(json).toMatchObject({ release: "1.0.0", commit: COMMIT, total: 2, paidPlacesLeft: 48, paidScans: 2, models: ["model-a", "model-b"] });
    expect(json.attestations.map((x: { id: string }) => x.id).sort()).toEqual([a, b].sort());
    const first = json.attestations.find((x: { id: string }) => x.id === a)!;
    expect(first).toMatchObject({
      model: "model-a",
      result: "pass",
      report: "Alice's report.",
      answers: mine.answers,
      paid: true,
      unpaidReason: null,
      owner: alice.signer.owner,
      proof: "message",
      message: `gleam-points:attest:v1:1.0.0:${a}`,
      createdAt: NOW.toISOString(),
    });
    expect(first.signature).toEqual(expect.any(String));
    expect(json.attestations.find((x: { id: string }) => x.id === b)!.proof).toBe("transaction");
  });

  it("lists every distinct model of the release on any page, not just the page's", async () => {
    const { s } = await withScans();
    await fillPaidPlaces(s.db, "1.0.0", 1);
    const first = await s.get("/attestations?limit=1");
    const second = await s.get(`/attestations?limit=1&cursor=${first.json.nextCursor}`);

    expect(first.json.models).toEqual(["model-a", "model-b", "x"]);
    expect(second.json.models).toEqual(first.json.models);
  });

  it("counts the distinct functions answered against all checking functions at the commit", async () => {
    const { s, mine, theirs } = await withScans();
    const { json } = await s.get("/attestations?release=1.0.0");

    const answered = new Set([...mine.answers, ...theirs.answers].map((answer) => `${answer.file}:${answer.symbol}`));
    expect(json.coverage.total).toBe(6);
    expect(json.coverage.examined).toBe(answered.size);
    expect(json.coverage.unexamined).toHaveLength(6 - answered.size);
    for (const fn of json.coverage.unexamined) expect(answered.has(`${fn.file}:${fn.symbol}`)).toBe(false);
  });

  it("leaves a voided attestation out of the list, the coverage and the paid places", async () => {
    const { s, a } = await withScans();
    await s.db.query("UPDATE attestations SET voided_at = now() WHERE id = $1", [a]);
    const { json } = await s.get("/attestations");

    expect(json.attestations).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.paidPlacesLeft).toBe(49);
    expect(json.coverage.examined).toBe(3);
  });

  it("starts empty with every function unexamined", async () => {
    const s = await setup();
    const { json } = await s.get("/attestations");
    expect(json).toMatchObject({ attestations: [], total: 0, paidPlacesLeft: 50, paidScans: 0, coverage: { examined: 0, total: 6 } });
    expect(json.coverage.unexamined).toHaveLength(6);
  });

  it("serves an older release that has attestations, using the commit they were made at", async () => {
    const s = await setup();
    s.github.releases["0.9.0"] = { commit: "9".repeat(40), files: surfaceFilesFor("Old") };
    await fillPaidPlaces(s.db, "0.9.0", 1, "9".repeat(40));
    const { json } = await s.get("/attestations?release=0.9.0");
    expect(json).toMatchObject({ release: "0.9.0", commit: "9".repeat(40), coverage: { total: 6 } });
    expect(s.github.calls.some((url) => url.includes("git/ref/tags/v0.9.0"))).toBe(false);
  });

  it("doesn't ask GitHub about a release that has no attestations and isn't the latest", async () => {
    const s = await setup();
    s.github.releases["0.9.0"] = { commit: "9".repeat(40), files: surfaceFilesFor("Old") };
    await s.get("/attestations");
    const before = s.github.calls.length;

    const { status, json } = await s.get("/attestations?release=0.9.0");
    for (let i = 0; i < 5; i++) await s.get(`/attestations?release=3.${i}.0`);

    expect(status).toBe(404);
    expect(json.code).toBe("unknown_release");
    expect(s.github.calls.length).toBe(before);
  });

  it("answers the latest release by name before it has any attestation", async () => {
    const s = await setup();
    expect((await s.get("/attestations?release=1.0.0")).json).toMatchObject({ release: "1.0.0", attestations: [] });
  });

  describe("pages", () => {
    async function many(n: number) {
      const s = await setup();
      await s.register(alice);
      await s.register(bob);
      await creditPreviousDay(s.db);
      await fillPaidPlaces(s.db, "1.0.0", n);
      // Spread creation times so newest-first is unambiguous.
      await s.db.query("UPDATE attestations SET created_at = '2026-10-01T00:00:00Z'::timestamptz + (right(id, 4)::int || ' minutes')::interval");
      return s;
    }

    it("returns the newest first, 50 by default, with a cursor to the rest", async () => {
      const s = await many(60);
      const first = await s.get("/attestations");

      expect(first.json.attestations).toHaveLength(50);
      expect(first.json.attestations[0]!.id.endsWith("0059")).toBe(true);
      expect(first.json.nextCursor).toEqual(expect.any(String));

      const second = await s.get(`/attestations?cursor=${first.json.nextCursor}`);
      expect(second.json.attestations).toHaveLength(10);
      expect(second.json.attestations.at(-1)!.id.endsWith("0000")).toBe(true);
      expect(second.json.nextCursor).toBeNull();
      const ids = [...first.json.attestations, ...second.json.attestations].map((x) => x.id);
      expect(new Set(ids).size).toBe(60);
    });

    it("computes coverage and paid places over every attestation on each page", async () => {
      const s = await many(3);
      const a = await s.get("/attestations?limit=1");
      const b = await s.get(`/attestations?limit=1&cursor=${a.json.nextCursor}`);

      expect(a.json.paidPlacesLeft).toBe(97);
      expect(b.json.paidPlacesLeft).toBe(97);
      expect(a.json.total).toBe(3);
      expect(b.json.total).toBe(3);
      expect(b.json.coverage).toEqual(a.json.coverage);
    });

    it("caps limit at 100 and refuses a bad limit or cursor", async () => {
      const s = await many(1);
      expect((await s.get("/attestations?limit=1000")).status).toBe(200);
      for (const query of ["limit=0", "limit=abc", "limit=-1", "cursor=nope"]) {
        const { status, json } = await s.get(`/attestations?${query}`);
        expect([status, json.code], query).toEqual([400, "malformed_request"]);
      }
    });

    it("refuses a cursor with an impossible timestamp", async () => {
      const s = await many(1);
      const cursor = Buffer.from(`2026-99-99T99:99:99Z_${"a".repeat(64)}`).toString("base64url");
      const { status, json } = await s.get(`/attestations?cursor=${cursor}`);
      expect([status, json.code]).toEqual([400, "malformed_request"]);
      expect(json.error).toContain("nextCursor from the previous page");
    });

    it("computes coverage on a first page only, and a later page reuses it or leaves it out", async () => {
      const s = await many(3);
      const first = await s.get("/attestations?limit=1");
      s.advance(30_000);
      const second = await s.get(`/attestations?limit=1&cursor=${first.json.nextCursor}`);
      expect(second.json.coverage).toEqual(first.json.coverage);

      s.advance(61_000);
      const cold = await s.get(`/attestations?limit=2&cursor=${first.json.nextCursor}`);
      expect(cold.json.coverage).toBeNull();
      expect(cold.json.paidPlacesLeft).toBe(97);
    });

    it("pages by (createdAt, id), so attestations in the same millisecond aren't skipped", async () => {
      const s = await many(5);
      await s.db.query("UPDATE attestations SET created_at = '2026-10-01T00:00:00Z'");
      const seen: string[] = [];
      let cursor = "";
      for (let i = 0; i < 5; i++) {
        const page = await s.get(`/attestations?limit=2${cursor}`);
        seen.push(...page.json.attestations.map((x) => x.id));
        if (!page.json.nextCursor) break;
        cursor = `&cursor=${page.json.nextCursor}`;
      }
      expect(new Set(seen).size).toBe(5);
    });
  });

  describe("older releases", () => {
    it("takes coverage from the database alone, with no GitHub call", async () => {
      const s = await setup();
      await s.register(alice);
      await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
      const { rows } = await s.db.query<{ function_total: number }>("SELECT function_total FROM attestations");
      expect(rows[0]?.function_total).toBe(6);

      // A newer release becomes the latest, so 1.0.0 is now old.
      s.github.releases["1.1.0"] = { commit: "1".repeat(40), files: surfaceFilesFor("New") };
      s.github.latest = "v1.1.0";
      s.advance(10 * 60_000);
      await s.get("/attestations");
      s.github.calls.length = 0;
      s.github.failWith = 500;

      const { status, json } = await s.get("/attestations?release=1.0.0");
      expect(status).toBe(200);
      expect(json.coverage).toEqual({ examined: 3, total: 6, unexamined: null, byArea: null });
      expect(s.github.calls.filter((url) => url.includes("git/trees/") || url.includes("raw."))).toHaveLength(0);
    });

    it("names the latest release's unexamined functions", async () => {
      const s = await setup();
      await s.register(alice);
      await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
      const full = await s.get("/attestations");
      expect(full.json.coverage.unexamined).toHaveLength(3);
    });
  });

  describe("cache", () => {
    it("serves a page from memory for a minute, and a new attestation clears it", async () => {
      const s = await setup();
      await s.register(alice);
      await s.register(bob);
      await creditPreviousDay(s.db);
      expect((await s.get("/attestations")).json.attestations).toHaveLength(0);

      await s.db.query("INSERT INTO challenges (id, release, commit, functions, created_at, expires_at) VALUES ('x', '1.0.0', $1, '[]', now(), now())", [COMMIT]);
      await s.db.query(
        "INSERT INTO attestations (id, release, commit, challenge_id, address, owner, signature, proof, message, body, paid, created_at) VALUES ($1, '1.0.0', $2, 'x', 'someone', 'o', 's', 'message', 'm', $3, false, now())",
        ["a".repeat(64), COMMIT, JSON.stringify({ model: "m", result: "pass", report: "r", answers: [] })],
      );
      expect((await s.get("/attestations")).json.attestations).toHaveLength(0);

      s.advance(60_000);
      expect((await s.get("/attestations")).json.attestations).toHaveLength(1);

      await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
      expect((await s.get("/attestations")).json.attestations).toHaveLength(2);
    });
  });

  it("404 unknown_release, 400 for a malformed release, 404 no_release", async () => {
    const s = await setup();
    expect((await s.get("/attestations?release=7.7.7")).json.code).toBe("unknown_release");
    expect((await s.get("/attestations?release=7.7.7")).status).toBe(404);
    expect((await s.get("/attestations?release=v1.0.0")).status).toBe(400);
    expect((await s.get("/attestations?release=v1.0.0")).json.code).toBe("malformed_request");

    const none = await setup({ latest: null });
    expect((await none.get("/attestations")).json.code).toBe("no_release");
  });

  it("fetches each commit's files from GitHub once across challenges, checks, submissions and listings", async () => {
    const { s } = await withScans();
    await s.post("/attestations/check", { attestation: attestationFor(s, await s.challenge()) });
    await s.get("/attestations");
    await s.get("/attestations?release=1.0.0");

    expect(s.github.calls.filter((url) => url.includes("git/trees/"))).toHaveLength(1);
    expect(s.github.calls.filter((url) => new URL(url).host === "raw.githubusercontent.com")).toHaveLength(4);
    expect(s.github.calls.filter((url) => url.endsWith("releases/latest"))).toHaveLength(1);
  });
});

describe("/me and /leave", () => {
  it("adds scan points to a wallet's total and shows them on their own", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));

    const devices = await s.db.query<{ id: string; public_key_jwk: unknown }>(
      "SELECT d.id FROM devices d JOIN wallets w ON w.device_id = d.id WHERE w.address = $1",
      [alice.address],
    );
    expect(devices.rows).toHaveLength(1);
    const { scoresForDevice } = await import("../points/score");
    const scores = await scoresForDevice(s.db, devices.rows[0]!.id, 1, new Date());

    // Holding on 2026-10-07 (3,000,000 + 99,000,000 on the 6th) plus the 10,000 scan reward.
    expect(scores.wallets[0]).toMatchObject({ address: alice.address, scanPointsAtomic: "10000", totalAtomic: "102010000" });
    expect(scores.wallets[0]!.rank).toBe(1);
  });

  it("reports 0 scan points for a wallet without any", async () => {
    const s = await setup();
    await s.register(alice);
    const devices = await s.db.query<{ id: string }>("SELECT device_id AS id FROM wallets");
    const { scoresForDevice } = await import("../points/score");
    const scores = await scoresForDevice(s.db, devices.rows[0]!.id, 1, new Date());
    expect(scores.wallets[0]).toMatchObject({ scanPointsAtomic: "0", totalAtomic: "0" });
  });

  it("keeps a leaver's attestation and removes their scan points", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    const attestation = attestationFor(s, await s.challenge());
    const { json } = await s.post("/attestations", await attestBody(alice, attestation));
    expect(await count(s.db, "scan_points")).toBe(1);

    expect((await s.post("/leave", await leaveBody(alice, NOW_SECONDS))).status).toBe(200);

    expect(await count(s.db, "wallets WHERE address = $1", [alice.address])).toBe(0);
    expect(await count(s.db, "scan_points")).toBe(0);
    expect(await count(s.db, "attestations WHERE id = $1", [json.attestationId])).toBe(1);
    const listed = await s.get("/attestations");
    expect(listed.json.attestations.map((x: { id: string }) => x.id)).toEqual([json.attestationId]);
    expect(listed.json.coverage.examined).toBe(3);
  });

  it("doesn't let a wallet that left and rejoined attest the release again", async () => {
    const s = await setup();
    await s.register(alice);
    await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    await s.post("/leave", await leaveBody(alice, NOW_SECONDS));
    await s.register(alice);

    const { status, json } = await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    expect(status).toBe(409);
    expect(json.code).toBe("already_attested");
  });
});

describe("GET /scan/rewards", () => {
  it("answers a null day and zeros before any snapshot day or pool row exists", async () => {
    const s = await setup();
    const { status, json, headers } = await s.get("/scan/rewards");
    expect(status).toBe(200);
    expect(json).toEqual({ day: null, issuedAtomic: "0", scanRewardAtomic: "0", bountyPoolAtomic: "0", roundStepPercent: 10 });
    expect(headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("is open to any origin", async () => {
    const s = await setup();
    const response = await s.app.request("/scan/rewards", { headers: { origin: "https://example.com", "x-forwarded-for": "10.0.0.1" } });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("reads the latest snapshot day before today, never today's", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    await s.db.query("INSERT INTO snapshot_runs (day, completed_at, wallet_count, failed_count) VALUES ('2026-10-08', now(), 1, 0)");
    await s.db.query("INSERT INTO points (day, address, holding_atomic, referee_bonus_atomic, referrer_bonus_atomic) VALUES ('2026-10-08', $1, 5000000, 0, 0)", [alice.address]);
    const { json } = await s.get("/scan/rewards");
    expect(json).toMatchObject({ day: "2026-10-07", issuedAtomic: "10000000", scanRewardAtomic: "10000" });
  });

  it("answers exactly what a paid scan submitted now is credited", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await s.db.query("INSERT INTO snapshot_runs (day, completed_at, wallet_count, failed_count) VALUES ('2026-10-07', now(), 2, 0)");
    for (const [address, holding] of [[alice.address, "1234567"], [bob.address, "8765"]] as const) {
      await s.db.query("INSERT INTO points (day, address, holding_atomic, referee_bonus_atomic, referrer_bonus_atomic) VALUES ('2026-10-07', $1, $2, 0, 0)", [address, holding]);
    }
    const rewards = await s.get("/scan/rewards");
    expect(rewards.json).toMatchObject({ day: "2026-10-07", issuedAtomic: "1243332", scanRewardAtomic: "1243" });

    const { json } = await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    expect(json).toMatchObject({ ok: true, paid: true, points: rewards.json.scanRewardAtomic });
  });

  it("sums the pool's daily and award rows", async () => {
    const s = await setup();
    await fillPaidPlaces(s.db, "1.0.0", 1);
    await s.db.query(
      `INSERT INTO bounty_pool (day, delta_atomic, reason, created_at) VALUES ('2026-10-06', 4000000000000, 'daily', now()), ('2026-10-07', 1000000000000, 'daily', now())`,
    );
    await s.db.query(
      "INSERT INTO bounty_pool (delta_atomic, reason, attestation_id, ref, created_at) VALUES (-440000000000, 'award', $1, 'https://github.com/x/y/pull/1', now())",
      ["0".repeat(64)],
    );
    const { json } = await s.get("/scan/rewards");
    expect(json.bountyPoolAtomic).toBe("4560000000000");
  });

  it("keeps an answer for a minute", async () => {
    const s = await setup();
    expect((await s.get("/scan/rewards")).json.bountyPoolAtomic).toBe("0");
    await s.db.query("INSERT INTO bounty_pool (day, delta_atomic, reason, created_at) VALUES ('2026-10-07', 5, 'daily', now())");
    expect((await s.get("/scan/rewards")).json.bountyPoolAtomic).toBe("0");
    s.advance(60_000);
    expect((await s.get("/scan/rewards")).json.bountyPoolAtomic).toBe("5");
  });

  it("is limited to 600 an hour per IP", async () => {
    const s = await setup();
    for (let i = 0; i < 600; i++) expect((await s.get("/scan/rewards")).status).toBe(200);
    const { status, json } = await s.get("/scan/rewards");
    expect(status).toBe(429);
    expect(json.code).toBe("rate_limited");
  });
});

describe("scan areas and rounds", () => {
  /** The area fixture with alice and bob registered and a previous day worth 10,000 a full place. */
  async function areas() {
    const s = await setup({ files: areaFilesFor() });
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    return s;
  }

  async function scan(s: Setup, wallet: TestWallet, area?: string) {
    return s.post("/attestations", await attestBody(wallet, attestationFor(s, await s.challenge(area))));
  }

  /** Records a scan of `area` straight into the database, answering `answers`. */
  async function recordScan(db: Db, n: number, area: string, answers: { file: string; symbol: string }[] = [], voided = false) {
    await db.query(
      "INSERT INTO challenges (id, release, commit, functions, created_at, expires_at, area) VALUES ($1, '1.0.0', $2, '[]', now(), now(), $3)",
      [`recorded-${n}`, COMMIT, area],
    );
    await db.query(
      `INSERT INTO attestations (id, release, commit, challenge_id, address, owner, signature, proof, message, body, paid, created_at, area, round, voided_at)
       VALUES ($1, '1.0.0', $2, $3, $4, 'o', 's', 'message', 'm', $5, false, now(), $6, 1, $7)`,
      [
        `e${n}`.padStart(64, "0"), COMMIT, `recorded-${n}`, `recorded-${n}`,
        JSON.stringify({ model: "x", result: "pass", report: "r", answers }), area, voided ? new Date() : null,
      ],
    );
  }

  describe("GET /scan/challenge", () => {
    it("draws from the area asked for and stores it", async () => {
      const s = await areas();
      const { status, json } = await s.get("/scan/challenge?area=signing");

      expect(status).toBe(200);
      expect(json.area).toBe("signing");
      for (const fn of json.functions) expect(fn.file.startsWith("lib/")).toBe(true);
      const { rows } = await s.db.query<{ area: string }>("SELECT area FROM challenges WHERE id = $1", [json.challenge]);
      expect(rows[0]?.area).toBe("signing");
    });

    it("picks the least covered area, then the lower tier, among those it can challenge", async () => {
      const s = await areas();
      expect((await s.challenge()).area).toBe("keys");
      await recordScan(s.db, 1, "keys", [
        { file: "src/a.ts", symbol: "guardA1" },
        { file: "src/a.ts", symbol: "guardA2" },
        { file: "src/k.ts", symbol: "guardK1" },
      ]);
      expect((await s.challenge()).area).toBe("signing");
      await recordScan(s.db, 2, "signing", [{ file: "lib/b.ts", symbol: "guardB1" }]);
      expect((await s.challenge()).area).toBe("boundary");
      // A voided scan doesn't count, and preview (one function) is never picked.
      await recordScan(s.db, 3, "boundary", [{ file: "app/d.ts", symbol: "guardD1" }, { file: "app/d.ts", symbol: "guardD2" }, { file: "app/e.ts", symbol: "guardE1" }], true);
      expect((await s.challenge()).area).toBe("boundary");
      // Boundary 1 of 3 now leads signing's 1 of 4.
      await recordScan(s.db, 4, "boundary", [{ file: "app/d.ts", symbol: "guardD1" }]);
      expect((await s.challenge()).area).toBe("signing");
    });

    it("draws the first function from the area's unexamined ones", async () => {
      const s = await areas();
      await recordScan(s.db, 1, "keys", [
        { file: "src/a.ts", symbol: "guardA1" },
        { file: "src/a.ts", symbol: "guardA2" },
        { file: "src/k.ts", symbol: "guardK1" },
      ]);
      for (let i = 0; i < 5; i++) expect((await s.challenge("keys")).functions[0]).toEqual({ file: "src/k.ts", symbol: "guardK2" });
    });

    it("once all are examined, draws the first function from the least looked at", async () => {
      const s = await areas();
      await recordScan(s.db, 1, "keys", [
        { file: "src/a.ts", symbol: "guardA1" },
        { file: "src/a.ts", symbol: "guardA2" },
        { file: "src/k.ts", symbol: "guardK1" },
      ]);
      await recordScan(s.db, 2, "keys", [
        { file: "src/a.ts", symbol: "guardA1" },
        { file: "src/a.ts", symbol: "guardA2" },
        { file: "src/k.ts", symbol: "guardK2" },
      ]);
      // A voided scan's look doesn't count.
      await recordScan(s.db, 3, "keys", [{ file: "src/k.ts", symbol: "guardK1" }], true);
      for (let i = 0; i < 5; i++) {
        const first = (await s.challenge("keys")).functions[0]!;
        expect(first.file).toBe("src/k.ts");
      }
    });

    it("400 malformed_request for an unknown area", async () => {
      const s = await areas();
      const { status, json } = await s.get("/scan/challenge?area=everything");
      expect(status).toBe(400);
      expect(json.code).toBe("malformed_request");
      expect(json.issues[0]?.path).toBe("area");
    });

    it("503 challenge_unavailable for an area with fewer than three functions", async () => {
      const s = await areas();
      const { status, json } = await s.get("/scan/challenge?area=preview");
      expect(status).toBe(503);
      expect(json.code).toBe("challenge_unavailable");
      expect(json.error).toContain("Approval preview");
    });
  });

  describe("POST /attestations", () => {
    it("accepts a second scan in another area as round 2, paying 10% more", async () => {
      const s = await areas();
      const first = await scan(s, alice, "keys");
      const second = await scan(s, alice, "signing");

      expect(first.json).toMatchObject({ ok: true, area: "keys", round: 1, points: "10000", paidPlacesLeft: 49 });
      expect(second.json).toMatchObject({ ok: true, area: "signing", round: 2, points: "11000", paidPlacesLeft: 48 });
      const { rows } = await s.db.query<{ area: string; round: number }>("SELECT area, round FROM attestations ORDER BY round");
      expect(rows).toEqual([{ area: "keys", round: 1 }, { area: "signing", round: 2 }]);
      // Another wallet's first scan is its own round 1.
      expect((await scan(s, bob, "keys")).json).toMatchObject({ round: 1, points: "10000" });
    });

    it("counts rounds over non-voided scans only", async () => {
      const s = await areas();
      const first = await scan(s, alice, "keys");
      await s.db.query("UPDATE attestations SET voided_at = now() WHERE id = $1", [first.json.attestationId]);
      expect((await scan(s, alice, "signing")).json).toMatchObject({ round: 1, points: "10000" });
    });

    it("409 already_attested for the same area, naming the least-covered area left", async () => {
      const s = await areas();
      await scan(s, alice, "keys");
      const again = attestationFor(s, await s.challenge("keys"));
      const expected = "This wallet already scanned the Key material area of v1.0.0; run `pnpm scan start --area signing` to scan Signing instead.";

      const { status, json } = await s.post("/attestations", await attestBody(alice, again));
      expect(status).toBe(409);
      expect(json).toMatchObject({ code: "already_attested", error: expected });
      expect(await count(s.db, "attestations")).toBe(1);

      const dry = await s.post("/attestations/check", { attestation: again, address: alice.address });
      expect([dry.status, dry.json.error]).toEqual([409, expected]);
      const forBob = await s.post("/attestations/check", { attestation: again, address: bob.address });
      expect(forBob.json).toMatchObject({ ok: true, area: "keys" });

      // Once signing is better covered, boundary is the one named.
      await recordScan(s.db, 1, "signing", [{ file: "lib/b.ts", symbol: "guardB1" }]);
      expect((await s.post("/attestations", await attestBody(alice, again))).json.error).toContain("--area boundary");
    });

    it("409 already_attested once every area that can be challenged is scanned", async () => {
      const s = await areas();
      for (const area of ["keys", "signing", "boundary"]) expect((await scan(s, alice, area)).status).toBe(200);

      const { status, json } = await scan(s, alice, "keys");
      expect(status).toBe(409);
      expect(json.error).toBe("This wallet has scanned every area of v1.0.0; wait for the next release.");
    });

    it("refuses a challenge issued before areas", async () => {
      const s = await areas();
      const challenge = await s.challenge();
      await s.db.query("UPDATE challenges SET area = NULL WHERE id = $1", [challenge.challenge]);
      const { status, json } = await s.post("/attestations", await attestBody(alice, attestationFor(s, challenge)));
      expect([status, json.code]).toEqual([409, "challenge_expired"]);
      expect(json.error).toContain("before scan areas");
    });
  });

  describe("GET /scan/areas", () => {
    it("lists the latest release's areas in tier order, kept for a minute", async () => {
      const s = await areas();
      await scan(s, alice, "keys");
      const { status, json, headers } = await s.get("/scan/areas");

      expect(status).toBe(200);
      expect(headers.get("access-control-allow-origin")).toBe("*");
      expect(headers.get("cache-control")).toBe("public, max-age=60");
      expect(json).toEqual({
        release: "1.0.0",
        areas: [
          { id: "keys", label: "Key material", tier: 1, functions: 4, examined: 3, scans: 1 },
          { id: "signing", label: "Signing", tier: 2, functions: 4, examined: 0, scans: 0 },
          { id: "boundary", label: "Trust boundary", tier: 3, functions: 3, examined: 0, scans: 0 },
          { id: "preview", label: "Approval preview", tier: 4, functions: 1, examined: 0, scans: 0 },
          { id: "build", label: "Build and release", tier: 5, functions: 0, examined: 0, scans: 0 },
        ],
      });

      await recordScan(s.db, 1, "signing");
      expect((await s.get("/scan/areas")).json.areas).toEqual(json.areas);
      s.advance(60_000);
      expect((await s.get("/scan/areas")).json.areas).toContainEqual(expect.objectContaining({ id: "signing", scans: 1 }));
    });

    it("says there is no release yet", async () => {
      const s = await setup({ latest: null });
      expect((await s.get("/scan/areas")).json.code).toBe("no_release");
    });
  });

  describe("GET /scan/next", () => {
    it("says what the scan earned and what the next round earns, least-covered area first", async () => {
      const s = await areas();
      const { json: scanned } = await scan(s, alice, "keys");
      const { status, json, headers } = await s.get(`/scan/next?attestation=${scanned.attestationId}`);

      expect(status).toBe(200);
      expect(headers.get("access-control-allow-origin")).toBe("*");
      expect(json).toEqual({
        release: "1.0.0",
        area: "keys",
        round: 1,
        points: "10000",
        nextRound: 2,
        nextRewardAtomic: "11000",
        nextPaid: true,
        areasLeft: [
          { id: "signing", label: "Signing", functions: 4, examined: 0 },
          { id: "boundary", label: "Trust boundary", functions: 3, examined: 0 },
        ],
        suggested: "signing",
      });

      await scan(s, bob, "signing");
      const after = await s.get(`/scan/next?attestation=${scanned.attestationId}`);
      expect(after.json.areasLeft).toEqual([
        { id: "boundary", label: "Trust boundary", functions: 3, examined: 0 },
        { id: "signing", label: "Signing", functions: 4, examined: 3 },
      ]);
      expect(after.json.suggested).toBe("boundary");
    });

    it("offers the next round the full reward with its round step, however many places are taken", async () => {
      const s = await areas();
      await fillPaidPlaces(s.db, "1.0.0", 19);
      const { json: scanned } = await scan(s, alice, "keys");
      expect(scanned).toMatchObject({ points: "10000", paidPlacesLeft: 80 });
      expect((await s.get(`/scan/next?attestation=${scanned.attestationId}`)).json).toMatchObject({ nextRound: 2, nextRewardAtomic: "11000" });
    });

    it("offers no area once the wallet has scanned every one", async () => {
      const s = await areas();
      let last = "";
      for (const area of ["keys", "signing", "boundary"]) last = (await scan(s, alice, area)).json.attestationId;
      const { json } = await s.get(`/scan/next?attestation=${last}`);
      expect(json).toMatchObject({ area: "boundary", round: 3, points: "12000", nextRound: 4, areasLeft: [], suggested: null });
    });

    it("says the next round is unpaid once the paid places are gone", async () => {
      const s = await areas();
      await fillPaidPlaces(s.db, "1.0.0", 100);
      const { json: scanned } = await scan(s, alice, "keys");
      const { json } = await s.get(`/scan/next?attestation=${scanned.attestationId}`);
      expect(json).toMatchObject({ points: "0", nextRound: 2, nextRewardAtomic: "0", nextPaid: false, suggested: "signing" });
    });

    it("offers no area on a release that is no longer the latest", async () => {
      const s = await areas();
      const { json: scanned } = await scan(s, alice, "keys");
      s.github.releases["1.1.0"] = { commit: "1".repeat(40), files: areaFilesFor() };
      s.github.latest = "v1.1.0";
      s.advance(10 * 60_000);
      const { json } = await s.get(`/scan/next?attestation=${scanned.attestationId}`);
      expect(json).toMatchObject({ release: "1.0.0", round: 1, areasLeft: [], suggested: null });
    });

    it("404 unknown_attestation for an id with no signed attestation or a voided one, 400 for a malformed id", async () => {
      const s = await areas();
      const unknown = await s.get(`/scan/next?attestation=${"a".repeat(64)}`);
      expect(unknown.status).toBe(404);
      expect(unknown.json).toMatchObject({
        code: "unknown_attestation",
        error: "No signed attestation has this id yet; sign it in Gleam from the link `pnpm scan finish` printed, then run `pnpm scan next` again.",
      });

      const { json: scanned } = await scan(s, alice, "keys");
      await s.db.query("UPDATE attestations SET voided_at = now()");
      expect((await s.get(`/scan/next?attestation=${scanned.attestationId}`)).json.code).toBe("unknown_attestation");

      for (const query of ["", "?attestation=xyz", `?attestation=${"A".repeat(64)}`]) {
        const { status, json } = await s.get(`/scan/next${query}`);
        expect([status, json.code], query).toEqual([400, "malformed_request"]);
      }
    });
  });

  describe("GET /attestations", () => {
    it("lists each scan's area and round, and coverage by area", async () => {
      const s = await areas();
      const first = await scan(s, alice, "keys");
      const second = await scan(s, alice, "signing");
      await fillPaidPlaces(s.db, "1.0.0", 1);
      const { json } = await s.get("/attestations");

      const byId = new Map(json.attestations.map((x) => [x.id, x]));
      expect(byId.get(first.json.attestationId)).toMatchObject({ area: "keys", round: 1 });
      expect(byId.get(second.json.attestationId)).toMatchObject({ area: "signing", round: 2 });
      expect(json.attestations.find((x) => x.id === "0".repeat(64))).toMatchObject({ area: null, round: null });
      expect(json.coverage.byArea).toEqual([
        { id: "keys", label: "Key material", examined: 3, total: 4 },
        { id: "signing", label: "Signing", examined: 3, total: 4 },
        { id: "boundary", label: "Trust boundary", examined: 0, total: 3 },
        { id: "preview", label: "Approval preview", examined: 0, total: 1 },
        { id: "build", label: "Build and release", examined: 0, total: 0 },
      ]);
    });
  });
});

describe("coverage across releases", () => {
  const NEXT_COMMIT = "d".repeat(40);

  /**
   * v1.0.0 with a scan answering guardB1, guardB2 and guardC1, then v1.1.0
   * as the latest: guardB1's text changes, and lib/c.ts gains a line above
   * its functions, which moves them without changing them.
   */
  async function twoReleases(options: { voided?: boolean } = {}) {
    const s = await setup();
    const answers = [
      { file: "lib/b.ts", symbol: "guardB1" },
      { file: "lib/b.ts", symbol: "guardB2" },
      { file: "lib/c.ts", symbol: "guardC1" },
    ];
    await s.db.query(
      "INSERT INTO challenges (id, release, commit, functions, created_at, expires_at, area) VALUES ('old', '1.0.0', $1, '[]', now(), now(), 'signing')",
      [COMMIT],
    );
    const id = "a".repeat(64);
    await s.db.query(
      `INSERT INTO attestations (id, release, commit, challenge_id, address, owner, signature, proof, message, body, paid, created_at, area, round, voided_at)
       VALUES ($1, '1.0.0', $2, 'old', 'someone', 'o', 's', 'message', 'm', $3, true, now(), 'signing', 1, $4)`,
      [id, COMMIT, JSON.stringify({ model: "x", result: "pass", report: "r", answers }), options.voided ? new Date() : null],
    );
    const spans = functionsOf(s.files);
    for (const answer of answers) {
      const fn = spans.find((span) => span.file === answer.file && span.symbol === answer.symbol)!;
      await s.db.query("INSERT INTO examined_functions (attestation_id, file, symbol, fingerprint) VALUES ($1, $2, $3, $4)", [
        id,
        fn.file,
        fn.symbol,
        fn.fingerprint,
      ]);
    }

    const next = {
      ...s.files,
      "lib/b.ts": s.files["lib/b.ts"]!.replace('"guardB1 refused"', '"guardB1 refused, changed"'),
      "lib/c.ts": `// moved down a line\n${s.files["lib/c.ts"]!}`,
    };
    s.github.releases["1.1.0"] = { commit: NEXT_COMMIT, files: next };
    s.github.latest = "v1.1.0";
    s.advance(61_000);
    return s;
  }

  it("counts a function examined on an earlier release when its text is unchanged, wherever it moved", async () => {
    const s = await twoReleases();
    const { json } = await s.get("/attestations");

    expect(json.release).toBe("1.1.0");
    expect(json.coverage.examined).toBe(2);
    expect(json.coverage.unexamined).toEqual([
      { file: "lib/b.ts", symbol: "guardB1" },
      { file: "lib/c.ts", symbol: "guardC2" },
      { file: "src/a.ts", symbol: "guardA1" },
      { file: "src/a.ts", symbol: "guardA2" },
    ].sort((x, y) => (`${x.file}` < `${y.file}` ? -1 : x.file === y.file ? (x.symbol < y.symbol ? -1 : 1) : 1)));
    expect(json.coverage.byArea?.find((area) => area.id === "signing")).toMatchObject({ examined: 2, total: 4 });
  });

  it("draws the next release's challenge from what is unexamined there", async () => {
    const s = await twoReleases();
    for (let i = 0; i < 5; i++) {
      const first = (await s.challenge("signing")).functions[0]!;
      expect(["lib/b.ts:guardB1", "lib/c.ts:guardC2"]).toContain(`${first.file}:${first.symbol}`);
    }
  });

  it("leaves out a voided scan's functions", async () => {
    const s = await twoReleases({ voided: true });
    expect((await s.get("/attestations")).json.coverage.examined).toBe(0);
  });

  it("opens the latest release's paid places once, from what is unexamined, and keeps the total", async () => {
    const s = await twoReleases();
    s.github.releases["1.1.1"] = s.github.releases["1.1.0"]!;
    s.github.latest = "v1.1.1";
    const first = await s.get("/attestations/count?release=1.1.1");
    expect(first.json).toMatchObject({ paidPlacesLeft: 2, paidScans: 0 });
    const { rows } = await s.db.query<{ release: string; paid_places: number }>("SELECT release, paid_places FROM scan_releases ORDER BY release");
    expect(rows).toEqual([{ release: "1.1.1", paid_places: 2 }]);

    await s.db.query("UPDATE scan_releases SET paid_places = 37 WHERE release = '1.1.1'");
    s.advance(61_000);
    expect((await s.get("/attestations/count?release=1.1.1")).json).toMatchObject({ paidPlacesLeft: 37 });
  });

  it("opens at least 50 paid places on an x.y.0 release", async () => {
    const s = await twoReleases();
    expect((await s.get("/attestations/count?release=1.1.0")).json).toMatchObject({ paidPlacesLeft: 50, paidScans: 0 });
  });

  it("keeps a total set before the floor", async () => {
    const s = await twoReleases();
    await s.db.query("INSERT INTO scan_releases (release, paid_places, created_at) VALUES ('1.1.0', 4, now())");

    expect((await s.get("/attestations/count?release=1.1.0")).json).toMatchObject({ paidPlacesLeft: 4 });
  });
});
