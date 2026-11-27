import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@gleam/core/src/backup/fixtures.testing.ts";
import { ReadsHandler } from "./reads";

const ADDRESS = "W".repeat(43);
const TOKEN = "T".repeat(43);

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubNetwork(extraTags: Record<string, string>) {
  const tags = Object.entries({ ticker: "TKN", denomination: "3", name: "Token", ...extraTags }).map(([name, value]) => ({ name, value }));
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("~process@1.0/compute&max-age")) return new Response(null);
    if (url.includes("compute/balances")) return Response.json("5000");
    if (url.includes("now/as/balance")) return new Response("5000");
    return Response.json({ data: { transactions: { edges: [{ node: { id: TOKEN, tags } }] } } });
  }) as unknown as typeof fetch;
}

const preview = () => new ReadsHandler(memoryStorage()).previewWatchedToken({ address: ADDRESS, processId: TOKEN });

describe("ReadsHandler: token supply and description", () => {
  it("carries the spawn tags' total supply and description", async () => {
    stubNetwork({ "total-supply": "10000000000000000", description: "  A test token.  " });
    const row = await preview();
    expect(row.totalSupply).toBe("10000000000000000");
    expect(row.description).toBe("A test token.");
  });

  it("leaves out a supply of 0, which a token that mints later spawns with, and a blank description", async () => {
    stubNetwork({ "total-supply": "0", description: "   " });
    const row = await preview();
    expect(row).not.toHaveProperty("totalSupply");
    expect(row).not.toHaveProperty("description");
  });

  it("leaves out a supply that isn't an atomic integer", async () => {
    stubNetwork({ "total-supply": "1e21" });
    expect(await preview()).not.toHaveProperty("totalSupply");
  });
});
