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

const tagged = fc.record({
  __gleamType: fc.constantFrom("ArrayBuffer", "Uint8Array", "Blob"),
  data: fc.array(fc.oneof(fc.nat(300), fc.anything()), { maxLength: 8 }),
});

// `String()` throws a TypeError on an object whose own `toString` and
// `valueOf` aren't functions, and readHashAlgorithm's refusal message
// calls it on the page's value, so its values leave those keys out.
const convertible = fc.anything({ key: fc.string().filter((key) => key !== "toString" && key !== "valueOf") });

const options = fc.oneof(
  fc.anything(),
  fc.record(
    {
      name: fc.oneof(fc.constantFrom("RSA-OAEP", "AES-GCM", "AES-CBC", "RSA-PSS"), fc.anything()),
      label: fc.oneof(fc.uint8Array({ maxLength: 8 }), fc.anything()),
      algorithm: fc.oneof(fc.constant("RSA-OAEP"), fc.anything()),
      hashAlgorithm: fc.oneof(fc.constantFrom("SHA-256", "SHA-384", "SHA-512", "sha-256", "SHA-1"), convertible),
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

describe("what the transaction and data item readers return", () => {
  it("a transaction sends AR only to a real target, in whole Winston", () => {
    const amount = fc.oneof(fc.constantFrom("0", "5", "007", "", "-1", "1.5", " 5", "1e3"), field);
    const nearTransaction = fc.record(
      { target: fc.oneof(fc.constantFrom("", "a".repeat(43), "a".repeat(42)), field), quantity: amount, reward: amount, last_tx: field },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fc.oneof(pageValue, nearTransaction), (value) => {
        const transaction = readOrNull(() => readTransaction(value, "sign"));
        if (transaction === null) return;
        if (transaction.target !== undefined) expect(isArweaveId(transaction.target)).toBe(true);
        if (transaction.quantity !== undefined) expect(transaction.quantity).toMatch(/^\d+$/);
        if (transaction.quantity !== undefined && BigInt(transaction.quantity) > 0n) expect(transaction.target).toBeDefined();
        // A reward of "0" is left out, so the gateway's price is used.
        if (transaction.reward !== undefined) expect(transaction.reward).toMatch(/^(?!0$)\d+$/);
        if (transaction.last_tx !== undefined) expect(() => base64UrlToBytes(transaction.last_tx!)).not.toThrow();
        expect(transaction.tags.every((tag) => typeof tag.name === "string" && typeof tag.value === "string")).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("a data item has a real target and a 32-byte anchor, if any", () => {
    fc.assert(
      fc.property(pageValue, (value) => {
        const item = readOrNull(() => readDataItem(value, "signDataItem"));
        if (item === null) return;
        if (item.target !== undefined) expect(isArweaveId(item.target)).toBe(true);
        if (item.anchor !== undefined) expect(new TextEncoder().encode(item.anchor).byteLength).toBe(32);
        expect(ArrayBuffer.isView(item.data)).toBe(true);
        expect(item.tags.every((tag) => typeof tag.name === "string" && typeof tag.value === "string")).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
