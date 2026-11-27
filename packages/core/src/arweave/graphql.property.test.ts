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

const owner = fc.constantFrom(SELF, OTHER, PROCESS, ...AO_MU_SIGNERS);
// Integer strings only: `queryActivityTransactions` reads `winston` with
// `BigInt()`, which throws a SyntaxError on anything else.
const winston = fc.constantFrom("", "0", "1", "250", "007");
const tag = fc.record({
  name: fc.constantFrom("Data-Protocol", "data-protocol", "Action", "action", "Recipient", "recipient", "Quantity", "quantity", "From-Process", "Sender", "order-id"),
  value: fc.constantFrom("ao", "AO", "Transfer", "transfer", "Credit-Notice", "register-interest", SELF, OTHER, PROCESS, "1", "5", "0", "abc"),
});

const node = fc.record({
  id: fc.constantFrom("tx-1", "tx-2", "tx-3", "tx-4", "tx-5", "tx-6"),
  owner: fc.record({ address: owner }),
  recipient: fc.option(fc.constantFrom(SELF, OTHER, PROCESS), { nil: null }),
  quantity: fc.record({ winston }),
  tags: fc.array(tag, { maxLength: 5 }),
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

describe("the GraphQL readers on any gateway reply", () => {
  it("each resolves or refuses with a plain Error", async () => {
    await fc.assert(
      fc.asyncProperty(reply, async (body) => {
        const fetchImpl = gateway(body);
        await readsCleanly(() => queryActivityTransactions(SELF, GATEWAY, 10, fetchImpl));
        await readsCleanly(() => queryAoTransferActivity(SELF, GATEWAY, 10, fetchImpl));
        await readsCleanly(() => queryL1TokenReceipts(SELF, GATEWAY, 10, fetchImpl));
        const heights = await readsCleanly(() => queryBlockHeights(["tx-1", "tx-2"], GATEWAY, fetchImpl));
        for (const height of heights?.values() ?? []) expect(typeof height).toBe("number");
      }),
      { numRuns: 150 },
    );
  });

  it("AR activity is the wallet's own sends and real receives, never an AO message", async () => {
    await fc.assert(
      fc.asyncProperty(wellFormed, async (body) => {
        const entries = (await readsCleanly(() => queryActivityTransactions(SELF, GATEWAY, 10, gateway(body)))) ?? [];
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
      { numRuns: 150 },
    );
  });

  it("an AO receive comes only from a notice a messenger unit signed", async () => {
    await fc.assert(
      fc.asyncProperty(wellFormed, async (body) => {
        const entries = (await readsCleanly(() => queryAoTransferActivity(SELF, GATEWAY, 10, gateway(body)))) ?? [];
        const nodes = nodesOf(body);
        for (const entry of entries) {
          const sources = nodes.filter((each) => each.id === entry.txId);
          const signer = entry.type === "receive" ? (address: string) => AO_MU_SIGNERS.includes(address) : (address: string) => address === SELF;
          expect(sources.some((each) => signer(each.owner.address))).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("an L1 token receipt is an unverified claim of a whole amount, to this wallet, by someone else", async () => {
    await fc.assert(
      fc.asyncProperty(wellFormed, async (body) => {
        const entries = (await readsCleanly(() => queryL1TokenReceipts(SELF, GATEWAY, 10, gateway(body)))) ?? [];
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
      { numRuns: 150 },
    );
  });
});
