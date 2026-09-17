import { describe, expect, it, vi } from "vitest";
import { queryTokenMetadata } from "./token-metadata";

const PROCESS_ID = "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY";

function fakeGraphQLFetch(edges: unknown[], ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data: { transactions: { edges } } }),
  })) as unknown as typeof fetch;
}

function edge(tags: Array<{ name: string; value: string }>) {
  return { node: { id: PROCESS_ID, tags } };
}

describe("queryTokenMetadata", () => {
  it("resolves ticker, denomination, name, description, logo, and total-supply from lower-cased spawn tags (live-verified shape for Legacy wUSDC)", async () => {
    const fetchImpl = fakeGraphQLFetch([
      edge([
        { name: "total-supply", value: "255018926306" },
        { name: "denomination", value: "6" },
        { name: "ticker", value: "wUSDC" },
        { name: "name", value: "Legacy wUSDC" },
        { name: "description", value: "Legacynet wrapped USDC tokens." },
        { name: "logo", value: "HPTSjRYXipZsTAwp9fPjAoTDEH2LTceuiMUXPQ39vEk" },
      ]),
    ]);

    const metadata = await queryTokenMetadata(PROCESS_ID, "https://arweave.net", fetchImpl);

    expect(metadata).toEqual({
      processId: PROCESS_ID,
      denomination: 6,
      ticker: "wUSDC",
      name: "Legacy wUSDC",
      description: "Legacynet wrapped USDC tokens.",
      logo: "HPTSjRYXipZsTAwp9fPjAoTDEH2LTceuiMUXPQ39vEk",
      totalSupply: "255018926306",
    });
  });

  it("matches tag names case-insensitively (title-cased tags also resolve)", async () => {
    const fetchImpl = fakeGraphQLFetch([
      edge([
        { name: "Ticker", value: "XYZ" },
        { name: "Name", value: "XYZ Token" },
      ]),
    ]);

    const metadata = await queryTokenMetadata(PROCESS_ID, "https://arweave.net", fetchImpl);

    expect(metadata.ticker).toBe("XYZ");
    expect(metadata.name).toBe("XYZ Token");
  });

  it("sets a field to null when the spawn tags didn't carry it, never a fabricated default", async () => {
    const fetchImpl = fakeGraphQLFetch([edge([{ name: "ticker", value: "ONLY" }])]);

    const metadata = await queryTokenMetadata(PROCESS_ID, "https://arweave.net", fetchImpl);

    expect(metadata.ticker).toBe("ONLY");
    expect(metadata.denomination).toBeNull();
    expect(metadata.name).toBeNull();
    expect(metadata.description).toBeNull();
    expect(metadata.logo).toBeNull();
    expect(metadata.totalSupply).toBeNull();
  });

  it("posts to {gateway}/graphql querying transactions by ids", async () => {
    const fetchImpl = fakeGraphQLFetch([edge([])]);
    await queryTokenMetadata(PROCESS_ID, "https://arweave.net/", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://arweave.net/graphql",
      expect.objectContaining({ method: "POST" }),
    );
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.variables.ids).toEqual([PROCESS_ID]);
  });

  it("throws when the gateway response is not ok", async () => {
    const fetchImpl = fakeGraphQLFetch([], false);
    await expect(
      queryTokenMetadata(PROCESS_ID, "https://arweave.net", fetchImpl),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("throws when GraphQL returns an errors array", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "bad query" }] }),
    })) as unknown as typeof fetch;

    await expect(
      queryTokenMetadata(PROCESS_ID, "https://arweave.net", fetchImpl),
    ).rejects.toThrow(/bad query/);
  });

  it("throws when no transaction is found for the process id (unspawned or unindexed)", async () => {
    const fetchImpl = fakeGraphQLFetch([]);
    await expect(
      queryTokenMetadata(PROCESS_ID, "https://arweave.net", fetchImpl),
    ).rejects.toThrow(/No spawn transaction found/);
  });

  it("ignores an invalid non-numeric denomination tag rather than coercing it, reporting null instead", async () => {
    const fetchImpl = fakeGraphQLFetch([edge([{ name: "denomination", value: "not-a-number" }])]);
    const metadata = await queryTokenMetadata(PROCESS_ID, "https://arweave.net", fetchImpl);
    expect(metadata.denomination).toBeNull();
  });
});
