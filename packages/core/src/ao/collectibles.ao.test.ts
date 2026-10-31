import { describe, expect, it } from "vitest";
import { L1_TOKEN_NODE_URLS } from "../models/network";
import { classifyAsset, discoverCollectibles } from "./collectibles";

const WALLET = "W".repeat(43);
const A = "A".repeat(43);
const B = "B".repeat(43);
const C = "C".repeat(43);
const FUNGIBLE = "F".repeat(43);
const COLLECTION = "K".repeat(43);
const COLLECTION2 = "L".repeat(43);
const GATEWAY = "https://gw.test";
const PEER = "https://peer.test";

const tags = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));

const BASE = { device: "process@1.0", "execution-device": "token@1.0" };
const NFT = { ...BASE, "hint-ui-style": "non-fungible", denomination: "0", "total-supply": "1", ticker: "ASSET" };

describe("classifyAsset", () => {
  it("accepts an NFT-shaped token process as unique", () => {
    expect(classifyAsset(tags(NFT))).toBe("unique");
  });

  it("falls back through hint-style and asset-type and ignores tag-name case", () => {
    const rest: Record<string, string> = { ...NFT };
    delete rest["hint-ui-style"];
    expect(classifyAsset(tags({ ...rest, "Asset-Type": "non-fungible" }))).toBe("unique");
  });

  it("classifies a fungible-tagged token as fungible", () => {
    expect(classifyAsset(tags({ ...BASE, "hint-ui-style": "fungible", denomination: "12" }))).toBe("fungible");
  });

  it("rejects non-token processes, wrong supply, wrong ticker and untyped tokens", () => {
    expect(classifyAsset(tags({ ...NFT, "execution-device": "lua@5.3a" }))).toBeNull();
    expect(classifyAsset(tags({ ...NFT, device: "other" }))).toBeNull();
    expect(classifyAsset(tags({ ...NFT, "total-supply": "2" }))).toBeNull();
    expect(classifyAsset(tags({ ...NFT, denomination: "2" }))).toBeNull();
    expect(classifyAsset(tags({ ...NFT, ticker: "FOO" }))).toBeNull();
    expect(classifyAsset(tags(BASE))).toBeNull();
  });
});

interface World {
  initial?: string[];
  market?: string[];
  received?: string[];
  descriptors: Record<string, Record<string, string>>;
  balances: Record<string, string | number>;
  /** Balances the gateway's HyperBEAM answers; ids missing here get a 500, as legacy assets do. */
  gatewayBalances?: Record<string, string | number>;
  /** The token nodes answer, and have never credited the wallet. */
  nodesReachable?: boolean;
}

function stubFetch(world: World) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const origin = new URL(url).origin;
    if (origin === new URL(GATEWAY).origin && url.includes("~process@1.0")) {
      const balance = world.gatewayBalances?.[url.split("/")[3]!.split("~")[0]!];
      return balance === undefined ? new Response("x", { status: 500 }) : Response.json(String(balance));
    }
    if (L1_TOKEN_NODE_URLS.includes(origin)) return new Response("x", { status: world.nodesReachable ? 404 : 500 });
    if (origin === new URL(PEER).origin) {
      const id = url.split("/")[3]!.split("~")[0]!;
      const balance = world.balances[id];
      if (balance === undefined) return new Response("no", { status: 404 });
      if (balance === "boom") return new Response("x", { status: 500 });
      return Response.json(String(balance));
    }
    const { query, variables } = JSON.parse(String(init?.body));
    const edge = (id: string, recipient: string | null, t: Record<string, string>) => ({
      cursor: id,
      node: { id, recipient, tags: tags(t) },
    });
    let edges;
    if (query.includes("$ids")) {
      edges = (variables.ids as string[])
        .filter((id) => world.descriptors[id])
        .map((id) => edge(id, null, world.descriptors[id]!));
    } else {
      const tagNames = (variables.tags as Array<{ name: string }>).map((t) => t.name);
      const ids = tagNames.includes("initial-holder") ? world.initial : tagNames.includes("recipient") ? world.received : world.market;
      edges = (ids ?? []).map((id) =>
        tagNames.includes("initial-holder") ? edge(id, null, {}) : edge("msg-" + id, id, {}),
      );
    }
    return Response.json({ data: { transactions: { pageInfo: { hasNextPage: false }, edges } } });
  }) as typeof fetch;
  return { impl, calls };
}

const run = (world: World) => {
  const { impl, calls } = stubFetch(world);
  return {
    calls,
    result: discoverCollectibles({ address: WALLET, gatewayUrl: GATEWAY, peerUrl: PEER, fetchImpl: impl }),
  };
};

describe("discoverCollectibles", () => {
  it("merges the three candidate sources, keeps held uniques and drops fungibles and zero balances", async () => {
    const { result } = run({
      initial: [A],
      market: [B],
      received: [C, FUNGIBLE, A],
      descriptors: {
        [A]: { ...NFT, name: "Alpha" },
        [B]: { ...NFT, name: "Bravo" },
        [C]: { ...NFT, name: "Charlie" },
        [FUNGIBLE]: { ...BASE, "hint-ui-style": "fungible", denomination: "12" },
      },
      balances: { [A]: 1, [B]: 0, [C]: "1", [FUNGIBLE]: 500 },
    });
    const list = await result;
    expect(list.map((c) => c.name).sort()).toEqual(["Alpha", "Charlie"]);
  });

  it("reads balances from the gateway first and falls back to the peer", async () => {
    const { result, calls } = run({
      initial: [A, B],
      descriptors: { [A]: { ...NFT, name: "Gateway" }, [B]: { ...NFT, name: "Peer" } },
      balances: { [A]: "boom", [B]: 1 },
      gatewayBalances: { [A]: 1 },
    });
    expect((await result).map((c) => c.name).sort()).toEqual(["Gateway", "Peer"]);
    expect(calls.some((u) => new URL(u).origin === new URL(PEER).origin && u.includes(A))).toBe(false);
  });

  it("treats a token node's 404 as not held", async () => {
    const { result } = run({ nodesReachable: true, initial: [A], descriptors: { [A]: NFT }, balances: {} });
    await expect(result).resolves.toEqual([]);
  });

  it("sets imageUrl only for image content types", async () => {
    const { result } = run({
      initial: [A, B, C],
      descriptors: {
        [A]: { ...NFT, name: "Pic", "content-type": "image/png" },
        [B]: { ...NFT, name: "Song", "content-type": "audio/mpeg" },
        [C]: { ...NFT, name: "Bare" },
      },
      balances: { [A]: 1, [B]: 1, [C]: 1 },
    });
    const byName = Object.fromEntries((await result).map((c) => [c.name, c]));
    expect(byName.Pic).toMatchObject({ contentType: "image/png", imageUrl: `${GATEWAY}/${A}` });
    expect(byName.Song?.contentType).toBe("audio/mpeg");
    expect(byName.Song).not.toHaveProperty("imageUrl");
    expect(byName.Bare).not.toHaveProperty("contentType");
    expect(byName.Bare).not.toHaveProperty("imageUrl");
  });

  it("names a collection from its own Name tag and falls back to a shortened id", async () => {
    const { result } = run({
      initial: [A, B, C],
      descriptors: {
        [A]: { ...NFT, name: "A", "base-collection": COLLECTION },
        [B]: { ...NFT, name: "B", "base-collection": COLLECTION2 },
        [C]: { ...NFT, name: "C" },
        [COLLECTION]: { Name: "Cool Cats" },
        [COLLECTION2]: {},
      },
      balances: { [A]: 1, [B]: 1, [C]: 1 },
    });
    const byName = Object.fromEntries((await result).map((c) => [c.name, c]));
    expect(byName.A).toMatchObject({ collectionId: COLLECTION, collectionName: "Cool Cats" });
    expect(byName.B).toMatchObject({ collectionId: COLLECTION2, collectionName: "LLLLL…LLLL" });
    expect(byName.C).not.toHaveProperty("collectionId");
    expect(byName.C).not.toHaveProperty("collectionName");
  });

  it("looks collections up only for held items", async () => {
    const { result, calls } = run({
      initial: [A],
      descriptors: { [A]: { ...NFT, "base-collection": COLLECTION } },
      balances: { [A]: 0 },
    });
    await result;
    expect(calls.filter((u) => u.includes("/graphql")).length).toBe(4); // 3 scans + 1 descriptor batch
  });

  it("throws when no balance can be read, rather than reporting an empty wallet", async () => {
    const { result } = run({ initial: [A], descriptors: { [A]: NFT }, balances: { [A]: "boom" } });
    await expect(result).rejects.toThrow(/balance/i);
  });

  it("skips malformed ids and caps candidates", async () => {
    const { impl, calls } = stubFetch({ initial: ["short", A, B], descriptors: { [A]: NFT, [B]: NFT }, balances: { [A]: 1, [B]: 1 } });
    const list = await discoverCollectibles({
      address: WALLET,
      gatewayUrl: GATEWAY,
      peerUrl: PEER,
      fetchImpl: impl,
      maxCandidates: 1,
    });
    expect(list).toHaveLength(1);
    expect(calls.filter((u) => new URL(u).origin === new URL(PEER).origin)).toHaveLength(1);
  });
});
