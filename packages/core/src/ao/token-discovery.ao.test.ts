import { describe, expect, it } from "vitest";
import { AO_MU_SIGNERS } from "../arweave/graphql";
import { discoverTokens } from "./token-discovery";

const WALLET = "W".repeat(43);
const FODDER = "EuEkh8ZYkoPKXimgjre7W268XXX_qRn5vofc66oRTOw";
const NFT = "N".repeat(43);
const LEGACY = "L".repeat(43);
const FORGED = "X".repeat(43);
const GATEWAY = "https://gw.test";

const tags = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));
const HB = { device: "process@1.0", "execution-device": "token@1.0", "scheduler-device": "arweave-scheduler@1.0" };
const DESCRIPTORS: Record<string, Array<{ name: string; value: string }>> = {
  [FODDER]: tags({ ...HB, "hint-ui-style": "fungible", ticker: "FODDER", denomination: "12" }),
  [NFT]: tags({ ...HB, "hint-ui-style": "non-fungible", denomination: "0", "total-supply": "1", ticker: "ASSET" }),
  [LEGACY]: tags({ "Data-Protocol": "ao", Type: "Process", Name: "artoken" }),
  [FORGED]: tags({ "Data-Protocol": "ao", Type: "Process" }),
};

function gateway(): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body));
    const edge = (node: Record<string, unknown>) => ({ cursor: String(node.id), node });
    let edges: unknown[] = [];
    if (query.includes("$ids")) {
      edges = (variables.ids as string[]).filter((id) => DESCRIPTORS[id]).map((id) => edge({ id, tags: DESCRIPTORS[id] }));
    } else if (variables.recipients) {
      edges = [
        edge({ id: "n1", recipient: WALLET, owner: { address: AO_MU_SIGNERS[1] }, tags: tags({ "From-Process": LEGACY }) }),
        edge({ id: "n2", recipient: WALLET, owner: { address: "Z".repeat(43) }, tags: tags({ "From-Process": FORGED }) }),
      ];
    } else if (JSON.stringify(variables.tags).includes("recipient")) {
      edges = [edge({ id: "t1", recipient: NFT, tags: [] }), edge({ id: "t2", recipient: "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY", tags: [] })];
    } else if (JSON.stringify(variables.tags).includes("register-interest")) {
      edges = [edge({ id: "m1", recipient: FODDER, tags: [] })];
    }
    return Response.json({ data: { transactions: { pageInfo: { hasNextPage: false }, edges } } });
  }) as typeof fetch;
}

describe("discoverTokens", () => {
  it("keeps fungible arweave-scheduler tokens and MU-credited legacy tokens, and nothing else", async () => {
    const found = await discoverTokens({ address: WALLET, gatewayUrl: GATEWAY, fetchImpl: gateway() });
    expect(found.map((token) => [token.processId, token.transport])).toEqual([
      [FODDER, "l1"],
      [LEGACY, "mu"],
    ]);
    expect(found[0]).toMatchObject({ ticker: "FODDER", denomination: 12, assetClass: "fungible" });
  });

  it("throws when the gateway can't be queried at all", async () => {
    const down = (async () => new Response("x", { status: 502 })) as typeof fetch;
    await expect(discoverTokens({ address: WALLET, gatewayUrl: GATEWAY, fetchImpl: down })).rejects.toThrow(/Token lookup/);
  });
});
