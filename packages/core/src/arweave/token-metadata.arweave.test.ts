import { describe, expect, it, vi } from "vitest";
import { crossCheckGatewayUrls, queryCheckedTokenMetadata, queryTokenMetadata, tokenLogoUrl, tokenMetadataFromTags } from "./token-metadata";

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
      transport: "mu",
      assetClass: null,
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

  it("ignores a transaction that isn't the process's own spawn", async () => {
    const other = { node: { id: "o".repeat(43), tags: [{ name: "Denomination", value: "12" }, { name: "Ticker", value: "wUSDC" }] } };
    await expect(
      queryTokenMetadata(PROCESS_ID, "https://arweave.net", fakeGraphQLFetch([other])),
    ).rejects.toThrow(/No spawn transaction found/);
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

describe("tokenLogoUrl", () => {
  const LOGO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

  it("serves a transaction-id logo from the gateway's own origin", () => {
    expect(tokenLogoUrl("https://arweave.net/", LOGO)).toBe(`https://arweave.net/${LOGO}`);
    expect(tokenLogoUrl("https://g.example/some/path", LOGO)).toBe(`https://g.example/${LOGO}`);
  });

  it("refuses anything that is not a transaction id, and any non-https gateway", () => {
    for (const logo of [null, "", "https://evil.example/x.png", "data:image/png;base64,AAAA", `${LOGO}/../x`, LOGO.slice(1)]) {
      expect(tokenLogoUrl("https://arweave.net", logo)).toBeNull();
    }
    expect(tokenLogoUrl("http://arweave.net", LOGO)).toBeNull();
    expect(tokenLogoUrl("not a url", LOGO)).toBeNull();
  });
});

describe("tokenMetadataFromTags", () => {
  it("routes an arweave-scheduler@1.0 fungible token over L1", () => {
    const metadata = tokenMetadataFromTags("EuEkh8ZYkoPKXimgjre7W268XXX_qRn5vofc66oRTOw", [
      { name: "device", value: "process@1.0" },
      { name: "execution-device", value: "token@1.0" },
      { name: "scheduler-device", value: "arweave-scheduler@1.0" },
      { name: "hint-ui-style", value: "fungible" },
      { name: "ticker", value: "FODDER" },
      { name: "denomination", value: "12" },
    ]);
    expect(metadata).toMatchObject({ transport: "l1", assetClass: "fungible", ticker: "FODDER", denomination: 12 });
  });

  it("routes a legacynet aos process through the MU", () => {
    const metadata = tokenMetadataFromTags("xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10", [
      { name: "Data-Protocol", value: "ao" },
      { name: "Type", value: "Process" },
      { name: "Name", value: "artoken" },
    ]);
    expect(metadata).toMatchObject({ transport: "mu", assetClass: null, ticker: null, name: "artoken" });
  });
});

describe("tokenMetadataFromTags denomination", () => {
  it("drops a denomination too large to scale by", () => {
    expect(tokenMetadataFromTags("p".repeat(43), [{ name: "Denomination", value: "2000000000" }]).denomination).toBeNull();
    expect(tokenMetadataFromTags("p".repeat(43), [{ name: "Denomination", value: "12" }]).denomination).toBe(12);
  });
});

describe("queryCheckedTokenMetadata", () => {
  /** Each gateway host answers with its own denomination tag; `null` fails the request. */
  function gatewaysFetch(denominations: Record<string, string | null>): typeof fetch {
    return vi.fn(async (url: string) => {
      const denomination = denominations[new URL(url).host];
      if (denomination === null || denomination === undefined) return { ok: false, status: 503, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { transactions: { edges: [{ node: { id: PROCESS_ID, tags: [{ name: "Denomination", value: denomination }] } }] } },
        }),
      };
    }) as unknown as typeof fetch;
  }
  const CHECKS = ["https://ar-io.dev", "https://permagate.io"];

  it("keeps the decimals when the other gateways agree", async () => {
    const fetchImpl = gatewaysFetch({ "arweave.net": "6", "ar-io.dev": "6", "permagate.io": "6" });
    const result = await queryCheckedTokenMetadata(PROCESS_ID, "https://arweave.net", CHECKS, fetchImpl);
    expect(result).toMatchObject({ check: "agreed", metadata: { denomination: 6 } });
  });

  it("drops the decimals when one other gateway reports different ones", async () => {
    const fetchImpl = gatewaysFetch({ "arweave.net": "12", "ar-io.dev": "6", "permagate.io": "12" });
    const result = await queryCheckedTokenMetadata(PROCESS_ID, "https://arweave.net", CHECKS, fetchImpl);
    expect(result).toMatchObject({ check: "disagreed", metadata: { denomination: null } });
  });

  it("gives a gateway that fails no vote", async () => {
    const fetchImpl = gatewaysFetch({ "arweave.net": "6", "ar-io.dev": null, "permagate.io": "6" });
    expect((await queryCheckedTokenMetadata(PROCESS_ID, "https://arweave.net", CHECKS, fetchImpl)).check).toBe("agreed");
  });

  it("drops the decimals when no other gateway answers", async () => {
    const fetchImpl = gatewaysFetch({ "arweave.net": "6", "ar-io.dev": null, "permagate.io": null });
    const result = await queryCheckedTokenMetadata(PROCESS_ID, "https://arweave.net", CHECKS, fetchImpl);
    expect(result).toMatchObject({ check: "unconfirmed", metadata: { denomination: null } });
  });

  it("throws when the user's own gateway fails, as queryTokenMetadata does", async () => {
    const fetchImpl = gatewaysFetch({ "arweave.net": null, "ar-io.dev": "6", "permagate.io": "6" });
    await expect(queryCheckedTokenMetadata(PROCESS_ID, "https://arweave.net", CHECKS, fetchImpl)).rejects.toThrow(/HTTP 503/);
  });
});

describe("crossCheckGatewayUrls", () => {
  it("picks two gateways other than the user's own", () => {
    expect(crossCheckGatewayUrls("https://arweave.net/")).toEqual(["https://ar-io.dev", "https://permagate.io"]);
    expect(crossCheckGatewayUrls("https://ar-io.dev")).toEqual(["https://arweave.net", "https://permagate.io"]);
    expect(crossCheckGatewayUrls("https://g.example")).toEqual(["https://arweave.net", "https://ar-io.dev"]);
  });
});
