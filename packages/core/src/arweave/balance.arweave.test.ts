import { describe, expect, it, vi } from "vitest";
import { getBalance } from "./balance";

function fakeFetch(body: string, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe("getBalance", () => {
  it("returns the raw Winston string, never converted to a number", async () => {
    const fetchImpl = fakeFetch("123456789012345678");
    const result = await getBalance("addr123", "https://arweave.net", fetchImpl);

    expect(result).toBe("123456789012345678");
    expect(typeof result).toBe("string");
  });

  it("hits GET {gateway}/wallet/{address}/balance", async () => {
    const fetchImpl = fakeFetch("0");
    await getBalance("addr123", "https://arweave.net/", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("https://arweave.net/wallet/addr123/balance");
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = fakeFetch("", false, 500);
    await expect(getBalance("addr123", "https://arweave.net", fetchImpl)).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("throws if the gateway returns a non-integer body", async () => {
    const fetchImpl = fakeFetch("not-a-number");
    await expect(getBalance("addr123", "https://arweave.net", fetchImpl)).rejects.toThrow(
      /non-integer/,
    );
  });

  it("preserves large balances exactly (no float precision loss)", async () => {
    const huge = "9007199254740993000"; // > Number.MAX_SAFE_INTEGER
    const fetchImpl = fakeFetch(huge);
    const result = await getBalance("addr123", "https://arweave.net", fetchImpl);
    expect(result).toBe(huge);
  });
});
