import { describe, expect, it, vi } from "vitest";
import { discoverHyperBeamPeers, findL1TokenNodes, normalizePeerUrl } from "./peer-discovery";
import { L1_CANARY_PROCESS_ID } from "../models/network";

function record(url: string, owner: string, timestamp: number) {
  return { cursor: `${owner}-${timestamp}`, node: { id: `${owner}-${timestamp}`, owner: { address: owner }, block: { timestamp }, tags: [{ name: "Url", value: url }] } };
}

function stubFetch(edges: ReturnType<typeof record>[], alive: Set<string>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/graphql")) {
      return new Response(JSON.stringify({ data: { transactions: { pageInfo: { hasNextPage: false }, edges } } }));
    }
    const origin = new URL(url).origin;
    return alive.has(origin) ? new Response("operator-address") : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("normalizePeerUrl", () => {
  it("keeps a public https origin", () => {
    expect(normalizePeerUrl("https://hb.node.test/")).toBe("https://hb.node.test");
  });

  it.each([
    "http://hb.node.test",
    "https://localhost:9000",
    "https://10.0.0.5",
    "https://abc.ngrok-free.app",
    "https://hb.1.2.3.4.sslip.io",
    "https://127.0.0.1.nip.io",
    "https://localhost./",
    "https://foo.localhost.",
    "https://hb.node.test.",
    "https://uri-did-ar-abc.smoke.test",
    "https://hb.node.test/path",
    "https://user:pw@hb.node.test",
    "not a url",
  ])("drops %s", (raw) => {
    expect(normalizePeerUrl(raw)).toBeNull();
  });
});

describe("discoverHyperBeamPeers", () => {
  it("returns live nodes, newest announcement per owner, newest first", async () => {
    const fetchImpl = stubFetch(
      [
        record("https://old.test", "owner-a", 100),
        record("https://new.test", "owner-a", 200),
        record("https://other.test", "owner-b", 150),
        record("https://dead.test", "owner-c", 300),
        record("https://localhost", "owner-d", 400),
      ],
      new Set(["https://new.test", "https://other.test", "https://old.test"]),
    );
    await expect(discoverHyperBeamPeers({ gatewayUrl: "https://gw.test", fetchImpl })).resolves.toEqual([
      "https://new.test",
      "https://other.test",
    ]);
  });

  it("never uses entries past the requested page size in an oversized gateway reply", async () => {
    const edges = Array.from({ length: 99 }, (_, i) => record(`https://filler-${i}.test`, `owner-${i}`, 1000 + i));
    edges.push(record("https://in-cap.test", "owner-live", 5000));
    // The 101st entry is past the page size the query asked for. It names a
    // live peer with the newest timestamp of all, so if it were kept it
    // would be probed and returned ahead of the in-cap peer.
    edges.push(record("https://beyond-cap.test", "owner-beyond", 999999));
    const fetchImpl = stubFetch(edges, new Set(["https://in-cap.test", "https://beyond-cap.test"]));
    await expect(discoverHyperBeamPeers({ gatewayUrl: "https://gw.test", fetchImpl })).resolves.toEqual(["https://in-cap.test"]);
  });

  it("returns an empty list when the gateway fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(discoverHyperBeamPeers({ gatewayUrl: "https://gw.test", fetchImpl })).resolves.toEqual([]);
  });
});

describe("findL1TokenNodes", () => {
  it("keeps the candidates that answer the canary's slot with a number, in order", async () => {
    const answers: Record<string, () => Response> = {
      "https://l1.test": () => new Response("1509"),
      "https://html.test": () => new Response("<!DOCTYPE html><html></html>"),
      "https://forbidden.test": () => new Response("1509", { status: 403 }),
      "https://also-l1.test": () => new Response(" 12\n"),
    };
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://down.test")) throw new TypeError("fetch failed");
      return answers[new URL(url).origin]!();
    }) as typeof fetch;

    const nodes = await findL1TokenNodes({
      candidates: ["https://l1.test/", "https://html.test", "https://down.test", "https://forbidden.test", "https://also-l1.test", "https://l1.test"],
      fetchImpl,
    });

    expect(nodes).toEqual(["https://l1.test", "https://also-l1.test"]);
    expect(calls).toContain(`https://l1.test/${L1_CANARY_PROCESS_ID}~process@1.0/slot/current`);
    expect(calls.filter((url) => url.startsWith("https://l1.test"))).toHaveLength(1);
  });
});
