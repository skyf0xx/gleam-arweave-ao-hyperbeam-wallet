// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isValidInviteCode } from "@gleam/core/src/points/index.ts";
import { createDropCode, parseDropCodeArgs } from "./drop-codes";
import { createTestDb } from "./test-db";

const options = { label: "X launch", seats: 50, prefix: "GLEAM" };
const suffixes = (...list: string[]) => () => list.shift()!;

describe("createDropCode", () => {
  it("makes a valid prefixed code and stores seats and label", async () => {
    const db = await createTestDb();
    const made = await createDropCode(db, options);
    expect(made.code).toMatch(/^GLEAM[A-Z2-9]{8}$/);
    expect(isValidInviteCode(made.code)).toBe(true);
    const { rows } = await db.query("SELECT code, seats, label FROM drop_codes");
    expect(rows).toEqual([{ code: made.code, seats: 50, label: "X launch" }]);
  });

  it("stores NULL seats for an unlimited code", async () => {
    const db = await createTestDb();
    const made = await createDropCode(db, { ...options, seats: null, label: "Reviewers" });
    const { rows } = await db.query<{ seats: number | null }>("SELECT seats FROM drop_codes WHERE code = $1", [made.code]);
    expect(rows[0]!.seats).toBeNull();
  });

  it("retries past a member code and an existing drop code", async () => {
    const db = await createTestDb();
    await db.query("INSERT INTO devices (id, public_key_jwk) VALUES ('d', '{}')");
    await db.query("INSERT INTO wallets (address, device_id, invite_code) VALUES ('a', 'd', 'GLEAMAAAAAAA')");
    await db.query("INSERT INTO drop_codes (code, seats, label) VALUES ('GLEAMBBBBBBB', 1, 'old')");
    const made = await createDropCode(db, options, suffixes("AAAAAAA", "BBBBBBB", "CCCCCCC"));
    expect(made.code).toBe("GLEAMCCCCCCC");
  });

  it("gives up after repeated clashes without inserting", async () => {
    const db = await createTestDb();
    await db.query("INSERT INTO drop_codes (code, seats, label) VALUES ('GLEAMAAAAAAA', 1, 'old')");
    await expect(createDropCode(db, options, () => "AAAAAAA")).rejects.toThrow(/unused code/);
    const { rows } = await db.query("SELECT 1 FROM drop_codes");
    expect(rows).toHaveLength(1);
  });
});

describe("parseDropCodeArgs", () => {
  it("parses seats, unlimited and prefix", () => {
    expect(parseDropCodeArgs(["--label", "X", "--seats", "50"])).toEqual({ label: "X", seats: 50, prefix: "GLEAM" });
    expect(parseDropCodeArgs(["--label", "R", "--unlimited", "--prefix", "rev"])).toEqual({
      label: "R",
      seats: null,
      prefix: "REV",
    });
  });

  it.each([
    [["--seats", "5"]],
    [["--label", "X"]],
    [["--label", "X", "--seats", "5", "--unlimited"]],
    [["--label", "X", "--seats", "0"]],
    [["--label", "X", "--seats", "1.5"]],
    [["--label", "X", "--seats", "5", "--prefix", "AB1"]],
    [["--label", "X", "--seats", "5", "--prefix", "ABCDEFGHI"]],
    [["--label", "X", "--seats", "5", "--bogus"]],
  ])("rejects %j", (argv) => {
    expect(() => parseDropCodeArgs(argv)).toThrow();
  });
});
