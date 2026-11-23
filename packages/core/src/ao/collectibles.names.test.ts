import { describe, expect, it } from "vitest";
import { discoverCollectibles } from "./collectibles";
import { PERMAWEB_NAMESPACE_ID } from "./names";

const WALLET = "W".repeat(43);
const NAME = "N".repeat(43);
const LISTED = "S".repeat(43);
const SPOOF = "X".repeat(43);
const NFT = "A".repeat(43);
const TARGET = "T".repeat(43);
const GATEWAY = "https://gw.test";
const PEER = "https://peer.test";

const tags = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));
const carrier = (name: string) => ({
  device: "process@1.0",
  "execution-device": "carrier@1.0",
  ticker: "NAME",
  "total-supply": "1",
  denomination: "0",
  name,
});
const walletKey = `uri-did-ar-${WALLET.toLowerCase()}abc`;

interface World {
  descriptors: Record<string, Record<string, string>>;
  /** Carrier `/now` state by process id; missing ids fail. */
  states: Record<string, unknown>;
  /** Namespace label → the process it resolves to. */
  namespace: Record<string, string>;
  /** NFT balances the peer answers. */
  balances?: Record<string, string>;
}

function stubFetch(world: World) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "HEAD") {
      const [, ns, label] = url.pathname.split("/");
      const id = ns === PERMAWEB_NAMESPACE_ID && label ? world.namespace[label] : undefined;
      return id
        ? new Response(null, { headers: { hashpath: `ao:${PERMAWEB_NAMESPACE_ID}/ao:${"H".repeat(43)}.${id}` } })
        : new Response(null, { status: 404 });
    }
    if (url.pathname.includes("~process@1.0")) {
      const id = url.pathname.slice(1).split("~")[0]!;
      if (url.pathname.endsWith("/now")) {
        const found = world.states[id];
        return found === undefined ? new Response("x", { status: 500 }) : Response.json(found);
      }
      const balance = url.origin === PEER ? world.balances?.[id] : undefined;
      return balance === undefined ? new Response("x", { status: 500 }) : new Response(balance);
    }
    const { query, variables } = JSON.parse(String(init?.body));
    const edge = (id: string, t: Record<string, string>) => ({ cursor: id, node: { id, recipient: null, tags: tags(t) } });
    if (query.includes("$ids")) {
      const edges = (variables.ids as string[]).filter((id) => world.descriptors[id]).map((id) => edge(id, world.descriptors[id]!));
      return Response.json({ data: { transactions: { pageInfo: { hasNextPage: false }, edges } } });
    }
    const initial = Object.keys(world.descriptors);
    return Response.json({
      data: Object.fromEntries(
        Object.keys(variables)
          .filter((key) => key.startsWith("t"))
          .map((key) => {
            const isInitial = (variables[key] as Array<{ name: string }>).some((t) => t.name === "initial-holder");
            return [`s${key.slice(1)}`, { pageInfo: { hasNextPage: false }, edges: isInitial ? initial.map((id) => edge(id, {})) : [] }];
          }),
      ),
    });
  }) as typeof fetch;
}

const discover = (world: World) =>
  // A second namespace host, since a label needs two hosts to agree on it.
  discoverCollectibles({ address: WALLET, gatewayUrl: GATEWAY, peerUrl: PEER, l1NodeUrls: ["https://node.test"], fetchImpl: stubFetch(world) });

describe("discoverCollectibles: Permaweb Names", () => {
  it("lists a held name the namespace confirms, as @label with its target", async () => {
    const items = await discover({
      descriptors: { [NAME]: carrier("zy") },
      states: { [NAME]: { "execution-device": "carrier@1.0", balances: { [walletKey]: 1 }, value: { target: TARGET } } },
      namespace: { zy: NAME },
    });
    expect(items).toEqual([{ id: NAME, name: "@zy", ticker: "NAME", permawebName: { label: "zy", target: TARGET } }]);
  });

  it("marks a name escrowed into the wallet's own sale order as listed", async () => {
    const items = await discover({
      descriptors: { [LISTED]: carrier("spacex") },
      states: {
        [LISTED]: {
          "execution-device": "carrier@1.0",
          balances: { [walletKey]: 0 },
          orders: { o: { creator: walletKey, quantity: 1, status: "open" } },
        },
      },
      namespace: { spacex: LISTED },
    });
    expect(items).toEqual([{ id: LISTED, name: "@spacex", ticker: "NAME", permawebName: { label: "spacex", listed: true } }]);
  });

  it("drops a carrier whose label the namespace maps elsewhere, and one the wallet doesn't hold", async () => {
    const held = { "execution-device": "carrier@1.0", balances: { [walletKey]: 1 } };
    const items = await discover({
      descriptors: { [SPOOF]: carrier("zy"), [NAME]: carrier("other") },
      states: { [SPOOF]: held, [NAME]: { "execution-device": "carrier@1.0", balances: {} } },
      namespace: { zy: NAME, other: NAME },
    });
    expect(items).toEqual([]);
  });

  it("strips a leading @ from an NFT's own name, so only names start with one", async () => {
    const items = await discover({
      descriptors: {
        [NFT]: { device: "process@1.0", "execution-device": "token@1.0", "hint-ui-style": "non-fungible", denomination: "0", "total-supply": "1", name: "@@alice" },
      },
      states: {},
      namespace: {},
      balances: { [NFT]: "1" },
    });
    expect(items.map((item) => item.name)).toEqual(["alice"]);
    expect(items[0]?.permawebName).toBeUndefined();
  });

  it("throws when no NFT balance or name state can be read", async () => {
    await expect(discover({ descriptors: { [NAME]: carrier("zy") }, states: {}, namespace: { zy: NAME } })).rejects.toThrow();
  });
});
