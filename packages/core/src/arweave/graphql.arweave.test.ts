import { describe, expect, it, vi } from "vitest";
import { queryActivityTransactions } from "./graphql";

const ADDRESS = "myAddr";

function fakeGraphQLFetch(edges: unknown[], ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data: { transactions: { edges } } }),
  })) as unknown as typeof fetch;
}

function edge(overrides: {
  id: string;
  ownerAddress: string;
  recipient: string | null;
  winston: string;
  timestamp: number | null;
}) {
  return {
    cursor: overrides.id,
    node: {
      id: overrides.id,
      owner: { address: overrides.ownerAddress },
      recipient: overrides.recipient,
      quantity: { winston: overrides.winston },
      tags: [{ name: "App-Name", value: "Gleam" }],
      block: overrides.timestamp === null ? null : { timestamp: overrides.timestamp },
    },
  };
}

describe("queryActivityTransactions", () => {
  it("classifies a transaction where address is the owner as a send", async () => {
    const fetchImpl = fakeGraphQLFetch([
      edge({ id: "tx1", ownerAddress: ADDRESS, recipient: "otherAddr", winston: "500", timestamp: 100 }),
    ]);

    const [entry] = await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry?.type).toBe("send");
    expect(entry?.address).toBe("otherAddr");
    expect(entry?.amount).toBe("500");
    expect(entry?.status).toBe("confirmed");
    expect(entry?.timestamp).toBe(100_000);
  });

  it("classifies a transaction where address is the recipient as a receive", async () => {
    const fetchImpl = fakeGraphQLFetch([
      edge({ id: "tx2", ownerAddress: "otherAddr", recipient: ADDRESS, winston: "42", timestamp: 200 }),
    ]);

    const [entry] = await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry?.type).toBe("receive");
    expect(entry?.address).toBe("otherAddr");
  });

  it("preserves amount as an atomic-integer string", async () => {
    const fetchImpl = fakeGraphQLFetch([
      edge({ id: "tx3", ownerAddress: ADDRESS, recipient: "x", winston: "9007199254740993000", timestamp: 1 }),
    ]);
    const [entry] = await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl);
    expect(entry?.amount).toBe("9007199254740993000");
    expect(typeof entry?.amount).toBe("string");
  });

  it("posts to {gateway}/graphql with owners/recipients set to the address", async () => {
    const fetchImpl = fakeGraphQLFetch([]);
    await queryActivityTransactions(ADDRESS, "https://arweave.net/", 25, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://arweave.net/graphql",
      expect.objectContaining({ method: "POST" }),
    );
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.variables.address).toEqual([ADDRESS]);
    expect(body.variables.first).toBe(25);
  });

  it("throws when the gateway response is not ok", async () => {
    const fetchImpl = fakeGraphQLFetch([], false);
    await expect(
      queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("throws when GraphQL returns an errors array", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "bad query" }] }),
    })) as unknown as typeof fetch;

    await expect(
      queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl),
    ).rejects.toThrow(/bad query/);
  });

  it("treats a null block as timestamp 0 (not-yet-mined edge case)", async () => {
    const fetchImpl = fakeGraphQLFetch([
      edge({ id: "tx4", ownerAddress: ADDRESS, recipient: "x", winston: "1", timestamp: null }),
    ]);
    const [entry] = await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl);
    expect(entry?.timestamp).toBe(0);
  });
});
