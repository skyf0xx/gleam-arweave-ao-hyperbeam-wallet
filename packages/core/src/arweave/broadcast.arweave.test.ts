import { afterEach, describe, expect, it, vi } from "vitest";
import { broadcastTransaction, type ArweaveTransactionJson } from "./transaction";

const GATEWAY = "https://arweave.net";
const NODE = "https://alpha.neo.zephyrdev.xyz";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const SIGNED: ArweaveTransactionJson = {
  format: 2,
  id: "i".repeat(43),
  last_tx: "a".repeat(64),
  owner: "o".repeat(683),
  tags: [],
  target: "t".repeat(43),
  quantity: "0",
  data: "",
  data_size: "0",
  data_root: "",
  reward: "1",
  signature: "s".repeat(683),
};

function answers(byHost: (host: string, attempt: number) => number) {
  const posts: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const host = new URL(String(input instanceof Request ? input.url : input)).origin;
    posts.push(host);
    const status = byHost(host, posts.filter((seen) => seen === host).length);
    return new Response(status === 404 ? "necessary-message-not-found" : "OK", { status });
  }) as unknown as typeof fetch;
  return posts;
}

describe("broadcastTransaction", () => {
  it("posts the same transaction again when a backend answers 404", async () => {
    const posts = answers((_, attempt) => (attempt === 1 ? 404 : 200));
    await expect(broadcastTransaction(GATEWAY, SIGNED, [0, 0])).resolves.toMatchObject({ status: 200 });
    expect(posts).toEqual([GATEWAY, GATEWAY]);
  });

  it("falls back to a token node when the gateway keeps failing", async () => {
    const posts = answers((host) => (host === GATEWAY ? 503 : 200));
    await expect(broadcastTransaction(GATEWAY, SIGNED, [0, 0])).resolves.toMatchObject({ status: 200 });
    expect(posts).toEqual([GATEWAY, GATEWAY, GATEWAY, NODE]);
  });

  it("stops at a 400: the network has judged the transaction", async () => {
    const posts = answers(() => 400);
    await expect(broadcastTransaction(GATEWAY, SIGNED, [0, 0])).resolves.toMatchObject({ status: 400 });
    expect(posts).toEqual([GATEWAY]);
  });

  it("reports the gateway's answer over a node's rejection", async () => {
    answers((host) => (host === GATEWAY ? 503 : 400));
    await expect(broadcastTransaction(GATEWAY, SIGNED, [0])).resolves.toMatchObject({ status: 503 });
  });

  it("reports the gateway's own answer when nothing accepts it", async () => {
    answers((host) => (host === GATEWAY ? 404 : 500));
    await expect(broadcastTransaction(GATEWAY, SIGNED, [0])).resolves.toEqual({ status: 404, statusText: "necessary-message-not-found" });
  });
});
