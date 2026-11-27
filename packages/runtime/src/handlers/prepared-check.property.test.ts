import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bytesToBase64Url, type UnsignedPayload } from "@gleam/core";
import { buildUnsignedDataItem, dataItemSignatureData } from "@gleam/core/src/arweave/data-item.ts";
import { buildUnsignedTransaction, transactionSignatureData } from "@gleam/core/src/arweave/transaction.ts";
import { checkDataItem, checkTransaction, type ExpectedDataItem, type ExpectedTransaction } from "./prepared-check";
import { address, text, winston } from "./signing-arbitraries.testing";

/*
 * The checks cover everything a signature covers: a payload built from
 * any other request passes the check for the approved one only when it
 * signs the very same bytes. The anchor a transaction fetches after
 * approval is the one field left out, so both sides share it here.
 */

const GATEWAY = "https://arweave.net";
const OWNER = bytesToBase64Url(new Uint8Array(512).map((_, index) => (index * 31 + 7) % 256));
const LAST_TX = bytesToBase64Url(new Uint8Array(48).fill(9));
/** Where an ANS-104 item's target presence byte sits: after the signature type, signature and owner. */
const AFTER_OWNER = 2 + 512 + 512;

const tags = fc.array(fc.record({ name: text(20).filter((name) => name.length > 0), value: text(40) }), { maxLength: 5 });
const data = fc.uint8Array({ maxLength: 512 });

/** `value` as it is, mostly, or something near it or new. */
function perturb<T>(value: T, change: fc.Arbitrary<T>): fc.Arbitrary<T> {
  return fc.oneof({ weight: 3, arbitrary: fc.constant(value) }, change);
}

type Tags = ExpectedTransaction["tags"];

function perturbTags(value: Tags): fc.Arbitrary<Tags> {
  const first = value[0];
  const swapped: Tags = first ? [{ name: first.value || "x", value: first.name }, ...value.slice(1)] : [];
  return perturb(
    value,
    fc.oneof(
      tags,
      fc.constant(value.slice(1)),
      fc.constant([...value].reverse()),
      tags.map((more) => [...value, ...more.slice(0, 1)]),
      fc.constant(swapped),
    ),
  );
}

function perturbData(value: Uint8Array) {
  return perturb(value, fc.oneof(data, fc.constant(Uint8Array.of(...value, 0)), fc.constant(value.slice(1))));
}

const transaction: fc.Arbitrary<ExpectedTransaction & { reward: string }> = fc.record({
  target: fc.oneof(fc.constant(""), address),
  quantity: winston,
  reward: winston,
  tags,
  data,
});

const variantOf = (approved: ExpectedTransaction & { reward: string }) =>
  fc.record({
    target: perturb(approved.target, fc.oneof(fc.constant(""), address)),
    quantity: perturb(approved.quantity, winston),
    reward: perturb(approved.reward, winston),
    tags: perturbTags(approved.tags),
    data: perturbData(approved.data),
  });

async function built(request: ExpectedTransaction & { reward: string }): Promise<UnsignedPayload & { kind: "transaction" }> {
  const { tags: requestTags, ...attributes } = request;
  return {
    kind: "transaction",
    transaction: await buildUnsignedTransaction(GATEWAY, OWNER, { ...attributes, last_tx: LAST_TX }, requestTags),
  };
}

function passes(check: () => void): boolean {
  try {
    check();
    return true;
  } catch (error) {
    expect((error as Error).message).toMatch(/doesn't match the request/);
    return false;
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe("checkTransaction passes exactly the payloads that sign the approved bytes", () => {
  it("for any approved transaction and any variant of it", async () => {
    let refused = 0;
    await fc.assert(
      fc.asyncProperty(
        transaction.chain((approved) => fc.tuple(fc.constant(approved), variantOf(approved))),
        async ([approved, variant]) => {
          const [mine, theirs] = await Promise.all([built(approved), built(variant)]);
          const same = sameBytes(await transactionSignatureData(mine.transaction), await transactionSignatureData(theirs.transaction));
          const passed = passes(() => checkTransaction(theirs, approved));
          if (!passed) refused += 1;
          expect(passed).toBe(same);
        },
      ),
      { numRuns: 200 },
    );
    // A variant changes some field in about 140 of 200 runs; 50 is many deviations under that.
    expect(refused).toBeGreaterThan(50);
  });
});

/** 32 bytes once UTF-8 encoded, in one-, two- and three-byte characters. */
const anchor = fc.oneof(
  fc.constant(""),
  fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), minLength: 32, maxLength: 32 }),
  fc.constantFrom("\u00e9".repeat(16), `${"\u20ac".repeat(10)}ab`),
);

const dataItem: fc.Arbitrary<Required<ExpectedDataItem>> = fc.record({
  target: fc.oneof(fc.constant(""), address),
  anchor,
  tags,
  data,
});

const itemVariantOf = (approved: Required<ExpectedDataItem>) =>
  fc.record({
    target: perturb(approved.target, fc.oneof(fc.constant(""), address)),
    // Any other length can't be built, which refuses the request before anything signs.
    anchor: perturb(approved.anchor, fc.oneof(anchor, fc.constantFrom("a".repeat(31), "a".repeat(33), "\u20ac".repeat(11)))),
    tags: perturbTags(approved.tags),
    data: perturbData(approved.data),
  });

const builtItem = (request: Required<ExpectedDataItem>): UnsignedPayload & { kind: "dataItem" } => ({
  kind: "dataItem",
  raw: buildUnsignedDataItem(OWNER, request),
});

/** The variant's item, or null when its anchor isn't 32 bytes and it can't be built at all. */
function builtOrRefused(request: Required<ExpectedDataItem>): (UnsignedPayload & { kind: "dataItem" }) | null {
  try {
    return builtItem(request);
  } catch (error) {
    expect((error as Error).message).toMatch(/anchor must be 32 bytes/);
    expect(new TextEncoder().encode(request.anchor).byteLength).not.toBe(32);
    return null;
  }
}

describe("checkDataItem passes exactly the payloads that sign the approved bytes", () => {
  it("for any approved item and any variant of it", async () => {
    let refused = 0;
    await fc.assert(
      fc.asyncProperty(
        dataItem.chain((approved) => fc.tuple(fc.constant(approved), itemVariantOf(approved))),
        async ([approved, variant]) => {
          const [mine, theirs] = [builtItem(approved), builtOrRefused(variant)];
          if (theirs === null) {
            refused += 1;
            return;
          }
          const same = sameBytes(await dataItemSignatureData(mine.raw), await dataItemSignatureData(theirs.raw));
          const passed = passes(() => checkDataItem(theirs, approved));
          if (!passed) refused += 1;
          expect(passed).toBe(same);
        },
      ),
      { numRuns: 150 },
    );
    // About 97 of 150 variants differ; 50 is many deviations under that.
    expect(refused).toBeGreaterThan(50);
  });

  it("refuses any one changed byte past the owner, unless the signature doesn't cover it", async () => {
    await fc.assert(
      fc.asyncProperty(dataItem, fc.nat(), fc.integer({ min: 1, max: 255 }), async (approved, position, flip) => {
        const raw = builtItem(approved).raw;
        const changed = raw.slice();
        const offset = AFTER_OWNER + (position % (raw.byteLength - AFTER_OWNER));
        changed[offset]! ^= flip;
        let signedSame: boolean;
        try {
          signedSame = sameBytes(await dataItemSignatureData(raw), await dataItemSignatureData(changed));
        } catch {
          // Bytes that don't parse as an item can't be signed at all.
          expect(() => checkDataItem({ kind: "dataItem", raw: changed }, approved)).toThrow();
          return;
        }
        let passed: boolean;
        try {
          checkDataItem({ kind: "dataItem", raw: changed }, approved);
          passed = true;
        } catch {
          passed = false;
        }
        if (passed) expect(signedSame).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});
