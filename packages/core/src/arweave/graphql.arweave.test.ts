import { describe, expect, it, vi } from "vitest";
import { AO_MU_SIGNERS, queryActivityTransactions, queryAoTransferActivity } from "./graphql";

const ADDRESS = "myAddr";

function fakeGraphQLFetch(edges: unknown[], ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data: { transactions: { edges } } }),
  })) as unknown as typeof fetch;
}

/** Answers the owners-side query with `sent` and the recipients-side query with `received`. */
function fakeSidedFetch(sent: unknown[], received: unknown[]): typeof fetch {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(init.body as string) as { query: string };
    const edges = query.includes("recipients:") ? received : sent;
    return { ok: true, status: 200, json: async () => ({ data: { transactions: { edges } } }) };
  }) as unknown as typeof fetch;
}

function edge(overrides: {
  id: string;
  ownerAddress: string;
  recipient: string | null;
  winston: string;
  timestamp: number | null;
  tags?: Array<{ name: string; value: string }>;
}) {
  return {
    cursor: overrides.id,
    node: {
      id: overrides.id,
      owner: { address: overrides.ownerAddress },
      recipient: overrides.recipient,
      quantity: { winston: overrides.winston },
      tags: overrides.tags ?? [{ name: "App-Name", value: "Gleam" }],
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

  it("queries the owners and recipients sides separately, since the gateway ANDs them", async () => {
    const fetchImpl = fakeGraphQLFetch([]);
    await queryActivityTransactions(ADDRESS, "https://arweave.net/", 25, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://arweave.net/graphql",
      expect.objectContaining({ method: "POST" }),
    );
    const bodies = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.variables.address).toEqual([ADDRESS]);
      expect(body.variables.first).toBe(25);
      expect(body.query.includes("owners:") && body.query.includes("recipients:")).toBe(false);
    }
  });

  it("returns both what the address sent and what it received", async () => {
    const fetchImpl = fakeSidedFetch(
      [edge({ id: "out", ownerAddress: ADDRESS, recipient: "otherAddr", winston: "5", timestamp: 2 })],
      [edge({ id: "in", ownerAddress: "otherAddr", recipient: ADDRESS, winston: "7", timestamp: 1 })],
    );

    const entries = await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entries.map((entry) => [entry.txId, entry.type])).toEqual(
      expect.arrayContaining([
        ["out", "send"],
        ["in", "receive"],
      ]),
    );
    expect(entries).toHaveLength(2);
  });

  it("leaves AO messages and zero-AR transactions out of the AR feed", async () => {
    const aoTags = [{ name: "Data-Protocol", value: "ao" }];
    const fetchImpl = fakeSidedFetch(
      [edge({ id: "aoOut", ownerAddress: ADDRESS, recipient: "process", winston: "0", timestamp: 1, tags: aoTags })],
      [
        edge({ id: "notice", ownerAddress: "mu", recipient: ADDRESS, winston: "0", timestamp: 1, tags: aoTags }),
        edge({ id: "dataItem", ownerAddress: "otherAddr", recipient: ADDRESS, winston: "0", timestamp: 1 }),
      ],
    );

    expect(await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl)).toEqual([]);
  });

  it("classifies a targetless zero-AR transaction the address signed as an upload", async () => {
    const fetchImpl = fakeSidedFetch(
      [edge({ id: "up", ownerAddress: ADDRESS, recipient: "", winston: "0", timestamp: 1 })],
      [],
    );

    const [entry] = await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry).toMatchObject({ txId: "up", type: "upload", address: ADDRESS, amount: null });
  });

  it("keeps a self-send once, as a send", async () => {
    const self = edge({ id: "self", ownerAddress: ADDRESS, recipient: ADDRESS, winston: "3", timestamp: 1 });
    const fetchImpl = fakeSidedFetch([self], [self]);

    const entries = await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("send");
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

  it("reports a transaction with no block yet as pending, timestamp 0", async () => {
    const fetchImpl = fakeGraphQLFetch([
      edge({ id: "tx4", ownerAddress: ADDRESS, recipient: "x", winston: "1", timestamp: null }),
    ]);
    const [entry] = await queryActivityTransactions(ADDRESS, "https://arweave.net", 10, fetchImpl);
    expect(entry?.timestamp).toBe(0);
    expect(entry?.status).toBe("pending");
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
    // Each of the two queries fails over once.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
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
  action?: string;
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
        { name: "Action", value: overrides.action ?? "Transfer" },
        { name: "Data-Protocol", value: "ao" },
        { name: "Quantity", value: overrides.quantity },
        ...(overrides.extraTags ?? []),
      ],
      block: overrides.timestamp === null ? null : { timestamp: overrides.timestamp },
    },
  };
}

const PROCESS = "tokenProcess";

function sentTransfer(id: string, payee: string, quantity: string) {
  return aoEdge({
    id,
    ownerAddress: ADDRESS,
    recipient: PROCESS,
    quantity,
    timestamp: 100,
    extraTags: [{ name: "Recipient", value: payee }],
  });
}

function creditNotice(id: string, payer: string, quantity: string, signer = AO_MU_SIGNERS[0]!) {
  return aoEdge({
    id,
    ownerAddress: signer,
    recipient: ADDRESS,
    action: "Credit-Notice",
    quantity,
    timestamp: 100,
    extraTags: [
      { name: "Sender", value: payer },
      { name: "From-Process", value: PROCESS },
    ],
  });
}

describe("queryAoTransferActivity", () => {
  it("reads a send from a Transfer the address signed: payee from the Recipient tag, token from its target", async () => {
    const fetchImpl = fakeSidedFetch([sentTransfer("msg1", "payee", "1500000")], []);

    const [entry] = await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry).toMatchObject({
      txId: "msg1",
      type: "send",
      status: "confirmed",
      address: "payee",
      amount: "1500000",
      token: PROCESS,
    });
  });

  it("reads a receive from a Credit-Notice: payer from Sender, token from From-Process", async () => {
    const fetchImpl = fakeSidedFetch([], [creditNotice("notice1", "payer", "42")]);

    const [entry] = await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry).toMatchObject({
      txId: "notice1",
      type: "receive",
      status: "confirmed",
      address: "payer",
      amount: "42",
      token: PROCESS,
    });
  });

  it("filters sends by owner and receives by the Credit-Notice action", async () => {
    const fetchImpl = fakeSidedFetch([], []);
    await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    const queries = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (JSON.parse(call[1].body) as { query: string }).query,
    );
    expect(queries.find((query) => !query.includes("recipients:"))).toContain('values: ["Transfer"]');
    expect(queries.find((query) => query.includes("recipients:"))).toContain('values: ["Credit-Notice"]');
  });

  it("asks the gateway only for Credit-Notices signed by an AO MU", async () => {
    const fetchImpl = fakeSidedFetch([], []);
    await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    const receiveRequest = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => JSON.parse(call[1].body) as { query: string; variables: Record<string, unknown> })
      .find((request) => request.query.includes("recipients:"));
    expect(receiveRequest?.query).toContain("owners: $signers");
    expect(receiveRequest?.variables.signers).toEqual(AO_MU_SIGNERS);
  });

  it("ignores a forged Credit-Notice not signed by an AO MU and keeps a genuine one", async () => {
    const fetchImpl = fakeSidedFetch(
      [],
      [creditNotice("forged", "payer", "1000000", "forger"), creditNotice("genuine", "payer", "42", AO_MU_SIGNERS[1])],
    );

    const entries = await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entries.map((entry) => entry.txId)).toEqual(["genuine"]);
  });

  it("drops a Credit-Notice with no From-Process, since its token is unknown", async () => {
    const notice = creditNotice("notice2", "payer", "1");
    notice.node.tags = notice.node.tags.filter((tag) => tag.name !== "From-Process");
    const fetchImpl = fakeSidedFetch([], [notice]);

    expect(await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl)).toEqual([]);
  });

  it("carries the Data-Protocol: ao tag through so merge.ts can detect failure", async () => {
    const fetchImpl = fakeSidedFetch([sentTransfer("msg3", "payee", "1")], []);

    const [entry] = await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry?.tags).toContainEqual({ name: "Data-Protocol", value: "ao" });
  });

  it("falls through to the next gateway on a first-gateway failure", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith("https://arweave.net")) {
        return { ok: false, status: 502, json: async () => ({}) };
      }
      const { query } = JSON.parse(init.body as string) as { query: string };
      const edges = query.includes("recipients:") ? [] : [sentTransfer("msg4", "payee", "1")];
      return { ok: true, status: 200, json: async () => ({ data: { transactions: { edges } } }) };
    }) as unknown as typeof fetch;

    const [entry] = await queryAoTransferActivity(ADDRESS, "https://arweave.net", 10, fetchImpl);

    expect(entry?.txId).toBe("msg4");
  });
});
