import { describe, expect, it, beforeEach, vi } from "vitest";
import { generateJWK } from "../keys/jwk";
import { signTransaction, dispatchTransaction, signDataItem, batchSignDataItem } from "./signing";
import { bytesToBase64 } from "./base64";
import type { JWKInterface } from "../models/wallet";

describe("vault/signing", () => {
  let jwk: JWKInterface;

  beforeEach(async () => {
    jwk = await generateJWK();
    vi.restoreAllMocks();
  });

  describe("signTransaction", () => {
    it("produces a signed transaction with id/owner/signature", async () => {
      const result = await signTransaction("https://arweave.net", jwk, {
        data: bytesToBase64(new TextEncoder().encode("hello")),
      });

      expect(result.id).toBeTruthy();
      expect(result.owner).toBe(jwk.n);
      expect(result.signature).toBeTruthy();
    });

    it("applies tags to the signed transaction", async () => {
      const result = await signTransaction("https://arweave.net", jwk, {
        data: bytesToBase64(new TextEncoder().encode("hi")),
        tags: [{ name: "App-Name", value: "Gleam" }],
      });
      expect(result.tags).toEqual([{ name: "App-Name", value: "Gleam" }]);
    });
  });

  describe("dispatchTransaction", () => {
    /**
     * arweave-js's `createTransaction`/`transactions.post` call the
     * gateway's `tx_anchor`/`price`/`tx` endpoints directly via ambient
     * `fetch` (no injection point — see `transfer.ts`'s own doc comment
     * for why this codebase mocks `globalThis.fetch` rather than passing
     * a parameter). This stub answers each endpoint generically by path.
     */
    function mockGatewayFetch(postStatus: number, postStatusText = "OK") {
      return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
        if (url.includes("tx_anchor")) {
          return new Response("0".repeat(64), { status: 200 });
        }
        if (url.includes("price")) {
          return new Response("100", { status: 200 });
        }
        return new Response(null, { status: postStatus, statusText: postStatusText });
      });
    }

    it("posts small payloads as a BASE transaction", async () => {
      const fetchSpy = mockGatewayFetch(200);

      const result = await dispatchTransaction("https://arweave.net", jwk, {
        data: bytesToBase64(new TextEncoder().encode("small payload")),
      });

      expect(result.type).toBe("BASE");
      expect(result.id).toBeTruthy();
      expect(fetchSpy).toHaveBeenCalled();
    });

    it("bundles large payloads as a BUNDLED data item without posting", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const largeData = new Uint8Array(150 * 1024).fill(1);

      const result = await dispatchTransaction("https://arweave.net", jwk, {
        data: bytesToBase64(largeData),
      });

      expect(result.type).toBe("BUNDLED");
      expect(result.id).toBeTruthy();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws when the gateway rejects the posted transaction", async () => {
      mockGatewayFetch(500, "Internal Server Error");

      await expect(
        dispatchTransaction("https://arweave.net", jwk, {
          data: bytesToBase64(new TextEncoder().encode("x")),
        }),
      ).rejects.toThrow(/Failed to dispatch transaction/);
    });
  });

  describe("signDataItem", () => {
    it("returns a base64-encoded signed ANS-104 data item", async () => {
      const result = await signDataItem(jwk, {
        data: bytesToBase64(new TextEncoder().encode("data item payload")),
        tags: [{ name: "Content-Type", value: "text/plain" }],
      });

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      // round-trips through base64 without throwing
      expect(() => atob(result)).not.toThrow();
    });
  });

  describe("batchSignDataItem", () => {
    it("signs multiple data items in order, returning one base64 string per input", async () => {
      const inputs = [
        { data: bytesToBase64(new TextEncoder().encode("item 1")) },
        { data: bytesToBase64(new TextEncoder().encode("item 2")) },
        { data: bytesToBase64(new TextEncoder().encode("item 3")) },
      ];

      const results = await batchSignDataItem(jwk, inputs);

      expect(results).toHaveLength(3);
      for (const item of results) {
        expect(typeof item).toBe("string");
        expect(item.length).toBeGreaterThan(0);
      }
      // each item is distinct (different payload)
      expect(new Set(results).size).toBe(3);
    });

    it("returns an empty array for an empty input list", async () => {
      const results = await batchSignDataItem(jwk, []);
      expect(results).toEqual([]);
    });
  });
});
