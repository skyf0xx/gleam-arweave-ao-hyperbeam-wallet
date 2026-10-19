// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { Db } from "./db";
import { createGithubClient } from "./github";
import { admitInstall, createTestDb } from "./test-db";
import { COMMIT, TEST_REPO, fakeGithub, functionsOf, surfaceFilesFor } from "./test-github";
import { attestBody, createTestDevice, createTestWallet, leaveBody, registerBody, type TestWallet } from "./test-signers";

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
  coverage: { examined: number; total: number; unexamined: { file: string; symbol: string }[] };
  attestations: { id: string; proof: string; signature: string }[];
  [key: string]: unknown;
}

async function setup(options: { latest?: string | null } = {}) {
  const db = await createTestDb();
  const files = surfaceFilesFor();
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
  const challenge = async () => (await get("/scan/challenge")).json as Challenge;

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

/** Fills paid places with attestations by wallets that don't exist. */
async function fillPaidPlaces(db: Db, release: string, n: number, commit = COMMIT) {
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
  it("issues three functions at the latest release's commit and stores the challenge", async () => {
    const s = await setup();
    const { status, json } = await s.get("/scan/challenge");

    expect(status).toBe(200);
    expect(json).toMatchObject({ release: "1.0.0", commit: COMMIT, expiresAt: "2026-10-09T12:00:00.000Z" });
    expect(json.challenge).toMatch(/^[A-Za-z0-9_-]{22,43}$/);
    expect(json.functions).toHaveLength(3);
    const known = functionsOf(s.files).map((fn) => `${fn.file}:${fn.symbol}`);
    for (const fn of json.functions) expect(known).toContain(`${fn.file}:${fn.symbol}`);
    expect(new Set(json.functions.map((fn: { file: string }) => fn.file)).size).toBe(3);

    const { rows } = await s.db.query<{ release: string; commit: string; used_by_attestation: string | null }>(
      "SELECT release, commit, used_by_attestation FROM challenges WHERE id = $1",
      [json.challenge],
    );
    expect(rows[0]).toEqual({ release: "1.0.0", commit: COMMIT, used_by_attestation: null });
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
    expect(json).toMatchObject({ ok: true, points: "10000", paid: true, unpaidReason: null, paidPlacesLeft: 19 });
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
    expect(json).toMatchObject({ points: "0", paid: false, unpaidReason: "no_snapshot", paidPlacesLeft: 20 });
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
    await fillPaidPlaces(s.db, "1.0.0", 20);

    const { status, json } = await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));

    expect(status).toBe(200);
    expect(json).toMatchObject({ points: "0", paid: false, unpaidReason: "places_taken", paidPlacesLeft: 0 });
    expect(await count(s.db, "attestations WHERE address = $1 AND NOT paid", [alice.address])).toBe(1);
    expect(await count(s.db, "scan_points")).toBe(0);
  });

  it("pays the 20th place and not the 21st", async () => {
    const s = await setup();
    await s.register(alice);
    await s.register(bob);
    await creditPreviousDay(s.db);
    await fillPaidPlaces(s.db, "1.0.0", 19);

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
    await fillPaidPlaces(s.db, "1.0.0", 20);
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
      await fillPaidPlaces(s.db, "1.0.0", 19);
      const forAlice = attestationFor(s, await s.challenge());
      const forBob = attestationFor(s, await s.challenge());

      const results = await Promise.all([
        s.post("/attestations", await attestBody(alice, forAlice)),
        s.post("/attestations", await attestBody(bob, forBob)),
      ]);

      expect(results.map((r) => r.json.paid).sort()).toEqual([false, true]);
      expect(await count(s.db, "attestations WHERE paid")).toBe(20);
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
    expect(first.json).toMatchObject({ ok: true, paidPlacesLeft: 20 });
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
    expect(json.paidPlacesLeft).toBe(13);
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
  it("counts a release's non-voided scans without GitHub, and answers 0 for one with none", async () => {
    const s = await setup();
    await s.register(alice);
    await s.post("/attestations", await attestBody(alice, attestationFor(s, await s.challenge())));
    s.github.calls.length = 0;

    const latest = await s.get("/attestations/count?release=1.0.0");
    const none = await s.get("/attestations/count?release=0.5.0");

    expect(latest.json).toEqual({ release: "1.0.0", total: 1 });
    expect(none.status).toBe(200);
    expect(none.json).toEqual({ release: "0.5.0", total: 0 });
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
    expect(json).toMatchObject({ release: "1.0.0", commit: COMMIT, total: 2, paidPlacesLeft: 18, models: ["model-a", "model-b"] });
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
    expect(json.paidPlacesLeft).toBe(19);
    expect(json.coverage.examined).toBe(3);
  });

  it("starts empty with every function unexamined", async () => {
    const s = await setup();
    const { json } = await s.get("/attestations");
    expect(json).toMatchObject({ attestations: [], total: 0, paidPlacesLeft: 20, coverage: { examined: 0, total: 6 } });
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

      expect(a.json.paidPlacesLeft).toBe(17);
      expect(b.json.paidPlacesLeft).toBe(17);
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
      expect(cold.json.paidPlacesLeft).toBe(17);
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
      expect(json.coverage).toEqual({ examined: 3, total: 6, unexamined: null });
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
    expect(s.github.calls.filter((url) => url.includes("raw.githubusercontent.com"))).toHaveLength(4);
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
    const { scoresForDevice } = await import("./score");
    const scores = await scoresForDevice(s.db, devices.rows[0]!.id, 1);

    // Holding on 2026-10-07 (3,000,000 + 99,000,000 on the 6th) plus the 10,000 scan reward.
    expect(scores.wallets[0]).toMatchObject({ address: alice.address, scanPointsAtomic: "10000", totalAtomic: "102010000" });
    expect(scores.wallets[0]!.rank).toBe(1);
  });

  it("reports 0 scan points for a wallet without any", async () => {
    const s = await setup();
    await s.register(alice);
    const devices = await s.db.query<{ id: string }>("SELECT device_id AS id FROM wallets");
    const { scoresForDevice } = await import("./score");
    const scores = await scoresForDevice(s.db, devices.rows[0]!.id, 1);
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
