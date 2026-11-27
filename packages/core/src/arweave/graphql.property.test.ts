import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isArweaveId } from "../models/arweave-id";
import { AO_MU_SIGNERS, queryActivityTransactions, queryAoTransferActivity, queryBlockHeights, queryL1TokenReceipts } from "./graphql";

/*
 * The gateway's reply is untrusted, and it may ignore every filter a query
 * sets. Here it answers each query with the same nodes, so only the
 * readers' own checks stand between a forged node and the activity feed.
 */

const GATEWAY = "https://gateway.example";
const SELF = "S".repeat(43);
const OTHER = "O".repeat(43);
const PROCESS = "P".repeat(43);
/** A few ids, so the same transaction comes back twice, as gateways do. */
const IDS = ["1", "2", "3", "4", "5", "6"].map((digit) => `tx${digit}${"_".repeat(39)}`);

const owner = fc.constantFrom(SELF, OTHER, PROCESS, ...AO_MU_SIGNERS);
// Mostly integers, so most replies pass the schema and reach the readers' own checks.
const winston = fc.oneof({ weight: 12, arbitrary: fc.constantFrom("", "0", "1", "250", "007") }, fc.constantFrom("abc", "1.5", "1e3", "-1"));
const tag = fc.record({
  name: fc.constantFrom("Data-Protocol", "data-protocol", "Action", "action", "Recipient", "recipient", "Quantity", "quantity", "From-Process", "Sender", "order-id"),
  value: fc.constantFrom("ao", "AO", "Transfer", "transfer", "Credit-Notice", "register-interest", SELF, OTHER, PROCESS, "1", "5", "0", "abc"),
});
const amount = fc.oneof({ weight: 3, arbitrary: fc.constant("5") }, fc.constantFrom("1", "0", "abc"));
const payee = fc.oneof({ weight: 3, arbitrary: fc.constant(SELF) }, fc.constant(OTHER));

/** The tags of an L1 transfer, an AO send and a Credit-Notice, sometimes missing one, beside a few random ones. */
const shapedTags = fc
  .oneof(
    { weight: 2, arbitrary: fc.tuple(payee, amount).map(([to, quantity]) => [
      { name: "action", value: "transfer" },
      { name: "recipient", value: to },
      { name: "quantity", value: quantity },
    ]) },
    fc.tuple(payee, amount).map(([to, quantity]) => [
      { name: "Data-Protocol", value: "ao" },
      { name: "Action", value: "Transfer" },
      { name: "Recipient", value: to },
      { name: "Quantity", value: quantity },
    ]),
    fc.tuple(fc.constantFrom(PROCESS, ""), amount).map(([process, quantity]) => [
      { name: "Data-Protocol", value: "ao" },
      { name: "Action", value: "Credit-Notice" },
      { name: "From-Process", value: process },
      { name: "Sender", value: OTHER },
      { name: "Quantity", value: quantity },
    ]),
  )
  .chain((shaped) =>
    fc.tuple(fc.array(tag, { maxLength: 2 }), fc.oneof({ weight: 3, arbitrary: fc.constant(true) }, fc.constant(false))).chain(([extra, whole]) => {
      const all = [...shaped, ...extra];
      const size = whole ? all.length : all.length - 1;
      return fc.shuffledSubarray(all, { minLength: size, maxLength: size });
    }),
  );

const node = fc.record({
  id: fc.constantFrom(...IDS),
  owner: fc.record({ address: owner }),
  recipient: fc.option(fc.constantFrom(SELF, OTHER, PROCESS), { nil: null }),
  quantity: fc.record({ winston }),
  tags: fc.oneof(fc.array(tag, { maxLength: 5 }), { weight: 3, arbitrary: shapedTags }),
  data: fc.option(fc.record({ size: fc.constantFrom("0", "12", "x") }), { nil: null }),
  block: fc.option(fc.record({ timestamp: fc.nat(), height: fc.nat() }), { nil: null }),
});

type Node = typeof node extends fc.Arbitrary<infer T> ? T : never;

const wellFormed = fc.array(node, { maxLength: 8 }).map((nodes) => ({ data: { transactions: { edges: nodes.map((each) => ({ cursor: "c", node: each })) } } }));
const reply = fc.oneof({ weight: 4, arbitrary: wellFormed }, fc.jsonValue({ maxDepth: 4 }));

/** Every gateway gives the same reply to every query, whatever it asked. */
const gateway = (body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status: 200 });

const nodesOf = (body: unknown): Node[] =>
  ((body as { data?: { transactions?: { edges?: Array<{ node: Node }> } } }).data?.transactions?.edges ?? []).map((edge) => edge.node);

/** Resolves, or refuses with a plain `Error`: a `TypeError` or `SyntaxError` means the reply reached code that assumed its shape. */
async function readsCleanly<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    expect((error as Error).constructor).toBe(Error);
    return null;
  }
}

/*
 * Floors on how many runs a reader returned something for, so a reader
 * that refused every reply can't pass. Measured means per 200 runs: AR
 * activity ~100, AO receives ~50, L1 receipts ~28, block heights ~165.
 * Each floor sits at least four standard deviations under its mean.
 */
const RUNS = 200;

describe("the GraphQL readers on any gateway reply", () => {
  it("each resolves or refuses with a plain Error", async () => {
    await fc.assert(
      fc.asyncProperty(reply, async (body) => {
        const fetchImpl = gateway(body);
        await readsCleanly(() => queryActivityTransactions(SELF, GATEWAY, 10, fetchImpl));
        await readsCleanly(() => queryAoTransferActivity(SELF, GATEWAY, 10, fetchImpl));
        await readsCleanly(() => queryL1TokenReceipts(SELF, GATEWAY, 10, fetchImpl));
        await readsCleanly(() => queryBlockHeights(IDS.slice(0, 2), GATEWAY, fetchImpl));
      }),
      { numRuns: RUNS },
    );
  });

  it("AR activity is the wallet's own sends and real receives, never an AO message", async () => {
    let read = 0;
    await fc.assert(
      fc.asyncProperty(wellFormed, async (body) => {
        const entries = (await readsCleanly(() => queryActivityTransactions(SELF, GATEWAY, 10, gateway(body)))) ?? [];
        if (entries.length > 0) read += 1;
        const nodes = nodesOf(body);
        expect(new Set(entries.map((entry) => entry.txId)).size).toBe(entries.length);
        for (const entry of entries) {
          const sources = nodes.filter((each) => each.id === entry.txId);
          // The reader takes a node's first Data-Protocol tag as its protocol.
          const isAo = (each: Node) => each.tags.find((one) => one.name.toLowerCase() === "data-protocol")?.value.toLowerCase() === "ao";
          expect(sources.some((each) => !isAo(each))).toBe(true);
          if (entry.type === "receive") {
            expect(sources.some((each) => each.owner.address === entry.address && entry.address !== SELF && /^0*[1-9]\d*$/.test(each.quantity.winston))).toBe(true);
          } else {
            expect(sources.some((each) => each.owner.address === SELF)).toBe(true);
          }
        }
      }),
      { numRuns: RUNS },
    );
    expect(read).toBeGreaterThan(40);
  });

  it("an AO receive comes only from a notice a messenger unit signed", async () => {
    let read = 0;
    await fc.assert(
      fc.asyncProperty(wellFormed, async (body) => {
        const entries = (await readsCleanly(() => queryAoTransferActivity(SELF, GATEWAY, 10, gateway(body)))) ?? [];
        if (entries.some((entry) => entry.type === "receive")) read += 1;
        const nodes = nodesOf(body);
        for (const entry of entries) {
          const sources = nodes.filter((each) => each.id === entry.txId);
          const signer = entry.type === "receive" ? (address: string) => AO_MU_SIGNERS.includes(address) : (address: string) => address === SELF;
          expect(sources.some((each) => signer(each.owner.address))).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
    expect(read).toBeGreaterThan(12);
  });

  it("an L1 token receipt is an unverified claim of a whole amount, to this wallet, by someone else", async () => {
    let read = 0;
    await fc.assert(
      fc.asyncProperty(wellFormed, async (body) => {
        const entries = (await readsCleanly(() => queryL1TokenReceipts(SELF, GATEWAY, 10, gateway(body)))) ?? [];
        if (entries.length > 0) read += 1;
        const nodes = nodesOf(body);
        for (const entry of entries) {
          expect(entry.unverified).toBe(true);
          expect(entry.type).toBe("receive");
          expect(entry.amount).toMatch(/^[1-9]\d*$/);
          expect(entry.address).not.toBe(SELF);
          expect(isArweaveId(entry.token ?? "")).toBe(true);
          expect(
            nodes.some(
              (each) =>
                each.id === entry.txId &&
                each.recipient === entry.token &&
                each.owner.address === entry.address &&
                each.tags.some((one) => one.name === "recipient" && one.value === SELF),
            ),
          ).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
    expect(read).toBeGreaterThan(6);
  });

  it("a block height is the one the reply gives the last mined copy of that id", async () => {
    let read = 0;
    await fc.assert(
      fc.asyncProperty(wellFormed, fc.subarray(IDS, { minLength: 1 }), async (body, asked) => {
        const heights = await readsCleanly(() => queryBlockHeights(asked, GATEWAY, gateway(body)));
        if (heights === null) return;
        if (heights.size > 0) read += 1;
        const mined = nodesOf(body).filter((each) => each.block !== null);
        for (const id of asked) {
          const last = mined.filter((each) => each.id === id).at(-1);
          expect(heights.get(id)).toBe(last?.block?.height);
        }
        // An id nobody asked about still names a mined node; the caller only looks up its own.
        for (const [id, height] of heights) expect(mined.some((each) => each.id === id && each.block!.height === height)).toBe(true);
      }),
      { numRuns: RUNS },
    );
    expect(read).toBeGreaterThan(60);
  });
});
