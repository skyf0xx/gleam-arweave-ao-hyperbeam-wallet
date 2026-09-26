import { afterEach, describe, expect, it, vi } from "vitest";
import Arweave from "arweave";
import { estimateFee, submitTransfer } from "./transfer";

const jwk = await Arweave.init({}).wallets.generate();

const RECIPIENT = "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/**
 * Real `Response` objects — `arweave-js`'s internal `Api.request` calls
 * `res.headers.get(...)` and `res.clone().json()`, which a plain object
 * satisfying only `{ ok, status, json }` doesn't support.
 */
function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  globalThis.fetch = vi.fn(async () => {
    const response = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    const body = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
    return new Response(body, { status: response.status });
  }) as unknown as typeof fetch;
}

describe("estimateFee", () => {
  it("returns the fee as a Winston string from the gateway's price endpoint", async () => {
    mockFetchSequence([{ status: 200, body: "1234567" }]);
    const quote = await estimateFee("https://arweave.net", "recipientAddr");
    expect(quote.fee).toBe("1234567");
    expect(typeof quote.fee).toBe("string");
  });
});

describe("submitTransfer", () => {
  it("returns the signed transaction's txId on a successful post", async () => {
    mockFetchSequence([
      { status: 200, body: "anchor12345678901234567890123456789012345678" }, // getTransactionAnchor
      { status: 200, body: "1234567" }, // getPrice (reward)
      { status: 200, body: { ok: true } }, // post
    ]);

    const result = await submitTransfer("https://arweave.net", jwk, RECIPIENT, "1000000000000");
    expect(typeof result.txId).toBe("string");
    expect(result.txId.length).toBeGreaterThan(0);
  });

  it("throws a descriptive error when the post fails", async () => {
    mockFetchSequence([
      { status: 200, body: "anchor12345678901234567890123456789012345678" },
      { status: 200, body: "1234567" },
      { status: 500, body: "internal error" },
    ]);

    await expect(
      submitTransfer("https://arweave.net", jwk, RECIPIENT, "1000000000000"),
    ).rejects.toThrow(/Failed to submit transfer/);
  });

  it("rejects a recipient that isn't an Arweave address before touching the network", async () => {
    mockFetchSequence([{ status: 200, body: "" }]);

    await expect(
      submitTransfer("https://arweave.net", jwk, "recipientAddr", "1000000000000"),
    ).rejects.toThrow(/must be an Arweave address/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
