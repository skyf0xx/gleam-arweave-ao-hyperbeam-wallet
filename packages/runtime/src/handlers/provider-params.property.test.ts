import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { base64UrlToBytes, isArweaveId } from "@gleam/core";
import {
  decodeProviderParams,
  readBytes,
  readDataItem,
  readDataItems,
  readEncryptAlgorithm,
  readHashAlgorithm,
  readProcessId,
  readTransaction,
} from "./provider-params";

/** What a page can put in a field: anything, base64url-ish text or bytes. */
const field = fc.oneof(
  fc.anything(),
  fc.base64String().map((text) => text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")),
  fc.uint8Array({ maxLength: 64 }),
  fc.array(fc.record({ name: fc.anything(), value: fc.anything() }, { requiredKeys: [] }), { maxLength: 4 }),
);

/** Objects shaped like a transaction or data item, with any values in the fields. */
const shaped = fc.record(
  { data: field, tags: field, target: field, anchor: field, quantity: field, reward: field, last_tx: field, format: field },
  { requiredKeys: [] },
);

const pageValue = fc.oneof(fc.anything(), shaped, fc.array(shaped, { maxLength: 3 }));

/**
 * A reader either returns or refuses with a plain `Error` naming the
 * problem. A `TypeError` or `RangeError` means page input reached code
 * that assumed a shape, which is how a crafted request gets past a check.
 */
function refusesCleanly(read: () => unknown): void {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).constructor).toBe(Error);
    expect((error as Error).message.length).toBeGreaterThan(0);
  }
}

describe("page parameter readers on arbitrary input", () => {
  it("readTransaction returns or refuses with a plain Error", () => {
    fc.assert(fc.property(pageValue, (value) => refusesCleanly(() => readTransaction(value, "sign"))), { numRuns: 500 });
  });

  it("readDataItem and readDataItems return or refuse with a plain Error", () => {
    fc.assert(
      fc.property(pageValue, (value) => {
        refusesCleanly(() => readDataItem(value, "signDataItem"));
        refusesCleanly(() => readDataItems(value));
      }),
      { numRuns: 500 },
    );
  });

  it("readBytes returns or refuses with a plain Error in every string mode", () => {
    fc.assert(
      fc.property(field, fc.constantFrom("reject", "utf8", "base64url") as fc.Arbitrary<"reject" | "utf8" | "base64url">, (value, mode) =>
        refusesCleanly(() => readBytes(value, "data", mode)),
      ),
      { numRuns: 500 },
    );
  });
});

const byteValue = fc.oneof(fc.anything(), fc.anything({ key: fc.constantFrom("toString", "valueOf", "a") }));
const tagged = fc.record({
  __gleamType: fc.constantFrom("ArrayBuffer", "Uint8Array", "Blob"),
  data: fc.array(fc.oneof(fc.nat(300), byteValue), { maxLength: 8 }),
});

const options = fc.oneof(
  fc.anything(),
  fc.record(
    {
      name: fc.oneof(fc.constantFrom("RSA-OAEP", "AES-GCM", "AES-CBC", "RSA-PSS"), fc.anything()),
      label: fc.oneof(fc.uint8Array({ maxLength: 8 }), fc.anything()),
      algorithm: fc.oneof(fc.constant("RSA-OAEP"), fc.anything()),
      hashAlgorithm: fc.oneof(fc.constantFrom("SHA-256", "SHA-384", "SHA-512", "sha-256", "SHA-1"), fc.anything({ key: fc.constantFrom("toString", "valueOf", "a") }), fc.anything()),
    },
    { requiredKeys: [] },
  ),
);

describe("the other page parameter readers on arbitrary input", () => {
  it("decodeProviderParams returns a plain object or refuses with a plain Error", () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), tagged, fc.dictionary(fc.string(), fc.oneof(tagged, fc.anything()))), (value) =>
        refusesCleanly(() => {
          const decoded = decodeProviderParams(value);
          expect(decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)).toBe(true);
        }),
      ),
      { numRuns: 500 },
    );
  });

  it("readHashAlgorithm returns nothing or the one of the three hashes the page named", () => {
    fc.assert(
      fc.property(options, (value) =>
        refusesCleanly(() => {
          const hash = readHashAlgorithm(value, "signMessage");
          if (hash === undefined) return;
          expect(["SHA-256", "SHA-384", "SHA-512"]).toContain(hash);
          expect((value as { hashAlgorithm: unknown }).hashAlgorithm).toBe(hash);
        }),
      ),
      { numRuns: 500 },
    );
  });

  it("readEncryptAlgorithm returns RSA-OAEP with at most a byte label", () => {
    fc.assert(
      fc.property(options, fc.constantFrom("encrypt", "decrypt") as fc.Arbitrary<"encrypt" | "decrypt">, (value, method) =>
        refusesCleanly(() => {
          const algorithm = readEncryptAlgorithm(value, method);
          expect(algorithm.name).toBe("RSA-OAEP");
          expect(Object.keys(algorithm).every((key) => key === "name" || key === "label")).toBe(true);
          if ("label" in algorithm) expect(Object.prototype.toString.call(algorithm.label)).toBe("[object ArrayBuffer]");
        }),
      ),
      { numRuns: 500 },
    );
  });

  it("readProcessId returns only an Arweave id", () => {
    const nearId = fc.string({ unit: fc.constantFrom(..."AZaz09_-+/=. "), minLength: 42, maxLength: 44 });
    fc.assert(
      fc.property(fc.oneof(fc.anything(), nearId), (value) =>
        refusesCleanly(() => {
          const processId = readProcessId(value, "tokenBalance");
          expect(processId).toBe(value);
          expect(isArweaveId(processId)).toBe(true);
        }),
      ),
      { numRuns: 500 },
    );
  });
});

/** The reader's result, or null when it refused (which the properties above already cover). */
function readOrNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** Mostly a value the reader accepts, sometimes a near miss it must refuse, now and then any field. */
const near = (valid: unknown[], invalid: unknown[]) =>
  fc.oneof({ weight: 8, arbitrary: fc.constantFrom(...valid) }, { weight: 1, arbitrary: fc.constantFrom(...invalid) }, { weight: 1, arbitrary: field });
const ID = "a".repeat(43);
const NEAR_MISS_IDS = ["a".repeat(42), `${"a".repeat(42)}+`, `${ID}a`];

/*
 * Requests close enough to valid that the readers accept a good share, so
 * the assertions on what they return run. Measured means per 500 runs:
 * transactions ~105 accepted, ~35 sending AR, ~40 with a reward; data items
 * ~185 accepted, ~100 with an anchor, ~75 with a target. Each floor sits
 * at least four standard deviations under its mean.
 */
const nearTransaction = fc.record(
  {
    target: near([ID, ""], NEAR_MISS_IDS),
    quantity: near(["0", "5", "007", "18446744073709551616"], ["-1", "1.5", " 5", "1e3"]),
    reward: near(["0", "10"], ["", "x", "-5"]),
    last_tx: near(["AAAA"], ["A", "!!"]),
    data: near(["AAEC", new Uint8Array([1, 2])], ["!!"]),
    tags: near([[], [{ name: "QQ", value: "Qg" }]], [[{ name: "QQ" }], [{ name: "!!", value: "Qg" }]]),
  },
  { requiredKeys: [] },
);

const nearDataItem = fc.record(
  {
    data: near(["text", new Uint8Array([1]), "\uD800"], [7]),
    tags: near([[], [{ name: "A", value: "B" }], null], [[{ name: "A" }], "A"]),
    target: near([ID, ""], NEAR_MISS_IDS),
    anchor: near(["a".repeat(32), "é".repeat(16), ""], ["a".repeat(31), "a".repeat(33), "é".repeat(32)]),
  },
  { requiredKeys: ["data"] },
);

describe("what the transaction and data item readers return", () => {
  it("a transaction sends AR only to a real target, in whole Winston", () => {
    const counts = { accepted: 0, sendsAr: 0, rewarded: 0 };
    fc.assert(
      fc.property(fc.oneof(pageValue, { weight: 3, arbitrary: nearTransaction }), (value) => {
        const transaction = readOrNull(() => readTransaction(value, "sign"));
        if (transaction === null) return;
        counts.accepted += 1;
        if (transaction.target !== undefined) expect(isArweaveId(transaction.target)).toBe(true);
        if (transaction.quantity !== undefined) expect(transaction.quantity).toMatch(/^\d+$/);
        if (transaction.quantity !== undefined && BigInt(transaction.quantity) > 0n) {
          counts.sendsAr += 1;
          expect(transaction.target).toBeDefined();
        }
        // A reward of "0" is left out, so the gateway's price is used.
        if (transaction.reward !== undefined) {
          counts.rewarded += 1;
          expect(transaction.reward).toMatch(/^(?!0$)\d+$/);
        }
        if (transaction.last_tx !== undefined) expect(() => base64UrlToBytes(transaction.last_tx!)).not.toThrow();
        expect(transaction.tags.every((tag) => typeof tag.name === "string" && typeof tag.value === "string")).toBe(true);
      }),
      { numRuns: 500 },
    );
    expect(counts.accepted).toBeGreaterThan(50);
    expect(counts.sendsAr).toBeGreaterThan(8);
    expect(counts.rewarded).toBeGreaterThan(12);
  });

  it("a data item has a real target and a 32-byte anchor, if any", () => {
    const counts = { accepted: 0, anchored: 0, targeted: 0 };
    fc.assert(
      fc.property(fc.oneof(pageValue, { weight: 3, arbitrary: nearDataItem }), (value) => {
        const item = readOrNull(() => readDataItem(value, "signDataItem"));
        if (item === null) return;
        counts.accepted += 1;
        if (item.target !== undefined) {
          counts.targeted += 1;
          expect(isArweaveId(item.target)).toBe(true);
        }
        if (item.anchor !== undefined) {
          counts.anchored += 1;
          expect(new TextEncoder().encode(item.anchor).byteLength).toBe(32);
        }
        expect(ArrayBuffer.isView(item.data)).toBe(true);
        expect(item.tags.every((tag) => typeof tag.name === "string" && typeof tag.value === "string")).toBe(true);
      }),
      { numRuns: 500 },
    );
    expect(counts.accepted).toBeGreaterThan(60);
    expect(counts.anchored).toBeGreaterThan(30);
    expect(counts.targeted).toBeGreaterThan(25);
  });
});
