// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  awardFinding,
  formatPoints,
  parseAwardArgs,
  parseVoidArgs,
  voidAttestation,
  type Confirm,
} from "./bounty";
import type { Db } from "./db";
import { createTestDb } from "./test-db";

const ID = "a".repeat(64);
const ID2 = "b".repeat(64);
const REF = "https://github.com/x/y/pull/1";
const yes: Confirm = async () => true;
const no: Confirm = async () => false;

async function seed(db: Db, id = ID, address = "alice") {
  await db.query("INSERT INTO devices (id, public_key_jwk) VALUES ($1, '{}') ON CONFLICT DO NOTHING", [`d-${address}`]);
  await db.query("INSERT INTO wallets (address, device_id, invite_code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [address, `d-${address}`, `C${address}`]);
  await db.query("INSERT INTO challenges (id, release, commit, functions, created_at, expires_at) VALUES ($1, '1.0.0', 'c', '[]', now(), now())", [`ch-${id}`]);
  await db.query(
    `INSERT INTO attestations (id, release, commit, challenge_id, address, owner, signature, proof, message, body, paid, created_at)
     VALUES ($1, '1.0.0', 'c', $2, $3, 'o', 's', 'message', 'm', '{"model":"claude-x"}', true, now())`,
    [id, `ch-${id}`, address],
  );
}

const fund = (db: Db, atomic: string, day = "2026-10-01") =>
  db.query("INSERT INTO bounty_pool (day, delta_atomic, reason, created_at) VALUES ($1, $2, 'daily', now())", [day, atomic]);

async function run(db: Db, severity: "critical" | "high" | "medium" | "low", confirm: Confirm = yes, ref = REF, attestation = ID) {
  const lines: string[] = [];
  const result = await awardFinding(db, { attestation, severity, ref, yes: false }, confirm, (l) => lines.push(l));
  return { result, lines };
}

const balance = async (db: Db) =>
  (await db.query<{ b: string }>("SELECT coalesce(sum(delta_atomic), 0)::text AS b FROM bounty_pool")).rows[0]!.b;

describe("formatPoints", () => {
  it("shows 12 decimals trimmed, with grouping", () => {
    expect(formatPoints(1_500_000_000_000n)).toBe("1.5");
    expect(formatPoints(1_234_567_000_000_000_000n)).toBe("1,234,567");
    expect(formatPoints(10_000n)).toBe("0.00000001");
    expect(formatPoints(0n)).toBe("0");
  });
});

describe("parse args", () => {
  it("accepts good award args and says what to pass otherwise", () => {
    expect(parseAwardArgs(["--attestation", ID, "--severity", "high", "--ref", REF, "--yes"])).toEqual({ attestation: ID, severity: "high", ref: REF, yes: true });
    expect(() => parseAwardArgs(["--severity", "high", "--ref", REF])).toThrow(/--attestation/);
    expect(() => parseAwardArgs(["--attestation", ID, "--severity", "huge", "--ref", REF])).toThrow(/--severity must be one of/);
    expect(() => parseAwardArgs(["--attestation", ID, "--severity", "low", "--ref", "nope"])).toThrow(/--ref/);
    expect(() => parseAwardArgs(["--attestation", ID, "--severity", "low", "--ref", "http://x.io/1"])).toThrow(/https/);
  });

  it("parses void args", () => {
    expect(parseVoidArgs(["--attestation", ID])).toEqual({ attestation: ID, yes: false });
    expect(() => parseVoidArgs([])).toThrow(/--attestation/);
  });
});

describe("awardFinding", () => {
  it.each([
    ["critical", "500"],
    ["high", "250"],
    ["medium", "100"],
    ["low", "20"],
  ] as const)("pays the %s share of the pool", async (severity, amount) => {
    const db = await createTestDb();
    await seed(db);
    await fund(db, "1000");

    const { result, lines } = await run(db, severity);

    expect(result).toEqual({ paid: true, amount: BigInt(amount) });
    expect(await balance(db)).toBe(String(1000 - Number(amount)));
    const { rows } = await db.query("SELECT address, kind, amount_atomic::text AS amount, ref FROM scan_points");
    expect(rows).toEqual([{ address: "alice", kind: "finding", amount, ref: REF }]);
    const pool = await db.query("SELECT delta_atomic::text AS delta, reason, attestation_id, ref FROM bounty_pool WHERE reason = 'award'");
    expect(pool.rows).toEqual([{ delta: `-${amount}`, reason: "award", attestation_id: ID, ref: REF }]);
    expect(lines.join("\n")).toContain("claude-x");
  });

  it("prints balance, share, amount and wallet in human units", async () => {
    const db = await createTestDb();
    await seed(db);
    await fund(db, "4000000000000");
    const { lines } = await run(db, "high", no);
    expect(lines).toEqual([
      "Pool balance:  4 points (4000000000000 atomic)",
      "Share:         25% (high)",
      "Amount:        1 points (1000000000000 atomic)",
      "Wallet:        alice",
      "Attestation:   release 1.0.0, model claude-x",
      `Ref:           ${REF}`,
      "Cancelled. Nothing was written.",
    ]);
  });

  it("writes nothing when the confirmation is declined", async () => {
    const db = await createTestDb();
    await seed(db);
    await fund(db, "1000");
    const { result } = await run(db, "critical", no);
    expect(result.paid).toBe(false);
    expect(await balance(db)).toBe("1000");
    expect((await db.query("SELECT 1 FROM scan_points")).rows).toHaveLength(0);
  });

  it("skips the question with --yes", async () => {
    const db = await createTestDb();
    await seed(db);
    await fund(db, "1000");
    const asked: string[] = [];
    await awardFinding(db, { attestation: ID, severity: "low", ref: REF, yes: true }, async (q) => (asked.push(q), false), () => {});
    expect(asked).toEqual([]);
    expect(await balance(db)).toBe("980");
  });

  it("refuses a ref it already paid, even for another attestation", async () => {
    const db = await createTestDb();
    await seed(db);
    await seed(db, ID2, "bob");
    await fund(db, "1000");
    await run(db, "high");
    await expect(run(db, "high", yes, REF, ID2)).rejects.toThrow(/already been paid/);
    expect(await balance(db)).toBe("750");
  });

  it("refuses an unknown, voided or departed attestation and an empty pool", async () => {
    const db = await createTestDb();
    await seed(db);
    await expect(run(db, "low")).rejects.toThrow(/pool is empty/);
    await fund(db, "1000");
    await expect(run(db, "low", yes, REF, "c".repeat(64))).rejects.toThrow(/No attestation/);

    await db.query("UPDATE attestations SET voided_at = now()");
    await expect(run(db, "low")).rejects.toThrow(/voided/);
    await db.query("UPDATE attestations SET voided_at = NULL");

    await db.query("DELETE FROM wallets WHERE address = 'alice'");
    await expect(run(db, "low")).rejects.toThrow(/has left/);
    expect(await balance(db)).toBe("1000");
  });

  it("stops if the balance moved while confirming", async () => {
    const db = await createTestDb();
    await seed(db);
    await fund(db, "1000");
    const moving: Confirm = async () => (await fund(db, "1000", "2026-10-02"), true);
    await expect(run(db, "high", moving)).rejects.toThrow(/changed/);
    expect(await balance(db)).toBe("2000");
  });
});

describe("voidAttestation", () => {
  async function scanned(db: Db) {
    await seed(db);
    await db.query("INSERT INTO scan_points (address, attestation_id, kind, amount_atomic, created_at) VALUES ('alice', $1, 'scan', 7, now())", [ID]);
  }

  it("removes scan points, keeps finding points and frees the paid place", async () => {
    const db = await createTestDb();
    await scanned(db);
    await db.query("INSERT INTO scan_points (address, attestation_id, kind, amount_atomic, ref, created_at) VALUES ('alice', $1, 'finding', 500, $2, now())", [ID, REF]);
    const lines: string[] = [];

    const result = await voidAttestation(db, { attestation: ID, yes: false }, yes, (l) => lines.push(l));

    expect(result).toEqual({ voided: true, removed: 7n });
    const { rows } = await db.query("SELECT kind, amount_atomic::text AS amount FROM scan_points");
    expect(rows).toEqual([{ kind: "finding", amount: "500" }]);
    const paidTaken = await db.query("SELECT 1 FROM attestations WHERE paid AND voided_at IS NULL");
    expect(paidTaken.rows).toHaveLength(0);
    expect(lines.join("\n")).toContain("Finding points kept:  0.0000000005 points (500 atomic)");
  });

  it("writes nothing when declined, and refuses a second void", async () => {
    const db = await createTestDb();
    await scanned(db);
    const declined = await voidAttestation(db, { attestation: ID, yes: false }, no, () => {});
    expect(declined.voided).toBe(false);
    expect((await db.query("SELECT 1 FROM scan_points")).rows).toHaveLength(1);

    await voidAttestation(db, { attestation: ID, yes: true }, no, () => {});
    await expect(voidAttestation(db, { attestation: ID, yes: true }, no, () => {})).rejects.toThrow(/already voided/);
  });
});
