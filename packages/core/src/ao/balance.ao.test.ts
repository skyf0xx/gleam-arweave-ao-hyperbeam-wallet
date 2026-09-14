import { describe, expect, it, vi } from "vitest";
import { getTokenBalance } from "./balance";

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const PROCESS_ID = "proc123";
const ADDRESS = "addr456";
const PEER = "https://hyperbeam.example.com";

describe("getTokenBalance", () => {
  it("hits the compute/ path per ARCHITECTURE.md §0.2", async () => {
    const fetchImpl = fakeFetch("100");
    await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      `${PEER}/${PROCESS_ID}~process@1.0/compute/balances/${ADDRESS}`,
    );
  });

  it("parses a bare numeric-string balance response", async () => {
    const fetchImpl = fakeFetch("4200000000000");
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(result.quantity).toBe("4200000000000");
    expect(typeof result.quantity).toBe("string");
    expect(result.address).toBe(ADDRESS);
    expect(result.processId).toBe(PROCESS_ID);
  });

  it("parses an object balance response with ticker/denomination", async () => {
    const fetchImpl = fakeFetch({ balance: "999", ticker: "AO", denomination: 12 });
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(result.quantity).toBe("999");
    expect(result.ticker).toBe("AO");
    expect(result.denomination).toBe(12);
  });

  it("treats a zero balance as a valid quantity, not an error", async () => {
    const fetchImpl = fakeFetch("0");
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);
    expect(result.quantity).toBe("0");
  });

  it("throws on a non-2xx response (peer down)", async () => {
    const fetchImpl = fakeFetch(null, false, 502);
    await expect(getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl)).rejects.toThrow(
      /HTTP 502/,
    );
  });

  it("throws on an unrecognized response shape rather than guessing", async () => {
    const fetchImpl = fakeFetch({ unexpected: true });
    await expect(getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl)).rejects.toThrow(
      /Unrecognized AO balance response shape/,
    );
  });

  it("preserves large quantities exactly (no float precision loss)", async () => {
    const huge = "90071992547409930000";
    const fetchImpl = fakeFetch(huge);
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);
    expect(result.quantity).toBe(huge);
  });
});
