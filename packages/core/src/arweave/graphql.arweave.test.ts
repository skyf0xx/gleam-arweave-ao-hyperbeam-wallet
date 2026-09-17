import { describe, expect, it, vi } from "vitest";
import { queryActivityTransactions, queryAoTransferActivity } from "./graphql";

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

  it("falls through to the next gateway when the first one fails", async () => {
    const goodEdges = [
      edge({ id: "tx5", ownerAddress: ADDRESS, recipient: "x", winston: "9", timestamp: 5 }),
    ];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("https://arweave.net")) {
        return { ok: false, status: 502, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { transactions: { edges: goodEdges } } }) };
    }) as unknown as typeof fetch;

    const [entry] = await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry?.txId).toBe("tx5");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws only after every candidate gateway fails", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(
      queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl),
    ).rejects.toThrow(/failed/);
  });
});

function aoEdge(overrides: {
  id: string;
  ownerAddress: string;
  recipient: string | null;
  quantity: string;
  timestamp: number | null;
  extraTags?: Array<{ name: string; value: string }>;
}) {
  return {
    cursor: overrides.id,
    node: {
      id: overrides.id,
      owner: { address: overrides.ownerAddress },
      recipient: overrides.recipient,
      tags: [
        { name: "Action", value: "Transfer" },
        { name: "Data-Protocol", value: "ao" },
        { name: "Quantity", value: overrides.quantity },
        ...(overrides.extraTags ?? []),
      ],
      block: overrides.timestamp === null ? null : { timestamp: overrides.timestamp },
    },
  };
}

function fakeAoFetch(edges: unknown[], ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data: { transactions: { edges } } }),
  })) as unknown as typeof fetch;
}

describe("queryAoTransferActivity", () => {
  it("parses an AO transfer with the raw Quantity tag as a plain integer string (not winston-shaped)", async () => {
    const fetchImpl = fakeAoFetch([
      aoEdge({ id: "msg1", ownerAddress: "senderAddr", recipient: ADDRESS, quantity: "1500000", timestamp: 100 }),
    ]);

    const [entry] = await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry?.amount).toBe("1500000");
    expect(entry?.type).toBe("receive");
    expect(entry?.token).toBe(ADDRESS);
    expect(entry?.status).toBe("confirmed");
  });

  it("classifies a transfer where address is the message owner as a send", async () => {
    const fetchImpl = fakeAoFetch([
      aoEdge({ id: "msg2", ownerAddress: ADDRESS, recipient: "processId", quantity: "10", timestamp: 100 }),
    ]);

    const [entry] = await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry?.type).toBe("send");
  });

  it("carries the Data-Protocol: ao tag through so merge.ts can detect failure", async () => {
    const fetchImpl = fakeAoFetch([
      aoEdge({ id: "msg3", ownerAddress: "senderAddr", recipient: ADDRESS, quantity: "1", timestamp: 1 }),
    ]);

    const [entry] = await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry?.tags).toContainEqual({ name: "Data-Protocol", value: "ao" });
  });

  it("falls through to the next gateway on a first-gateway failure", async () => {
    const goodEdges = [
      aoEdge({ id: "msg4", ownerAddress: "senderAddr", recipient: ADDRESS, quantity: "1", timestamp: 1 }),
    ];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("https://arweave.net")) {
        return { ok: false, status: 502, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { transactions: { edges: goodEdges } } }) };
    }) as unknown as typeof fetch;

    const [entry] = await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry?.txId).toBe("msg4");
  });
});
