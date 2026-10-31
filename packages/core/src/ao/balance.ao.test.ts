import { describe, expect, it, vi } from "vitest";
import { getTokenBalance, readTokenBalance } from "./balance";

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
  it("hits the compute/ path per", async () => {
    const fetchImpl = fakeFetch("100");
    await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      `${PEER}/${PROCESS_ID}~process@1.0/compute/balances/${ADDRESS}`,
      { signal: expect.any(AbortSignal) },
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

  it("defaults a bare numeric response to AO's denomination (12), not 0", async () => {
    const fetchImpl = fakeFetch("500100000000");
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(result.denomination).toBe(12);
  });

  it("has no name for a bare-quantity response (HyperBEAM carries no name field)", async () => {
    const fetchImpl = fakeFetch("500100000000");
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(result.name).toBeNull();
  });

  it("parses an object balance response with ticker/denomination/name", async () => {
    const fetchImpl = fakeFetch({ balance: "999", ticker: "AO", denomination: 12, name: "AO" });
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(result.quantity).toBe("999");
    expect(result.ticker).toBe("AO");
    expect(result.denomination).toBe(12);
    expect(result.name).toBe("AO");
  });

  it("has no name for an object balance response that carries no name field", async () => {
    const fetchImpl = fakeFetch({ balance: "999", ticker: "AO", denomination: 12 });
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(result.name).toBeNull();
  });

  it("treats a zero balance as a valid quantity, not an error", async () => {
    const fetchImpl = fakeFetch("0");
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);
    expect(result.quantity).toBe("0");
  });

  it("reads a 404 (an address the token never credited) as a zero balance", async () => {
    const fetchImpl = fakeFetch(null, false, 404);
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(result.quantity).toBe("0");
    expect(result.denomination).toBe(12);
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

describe("readTokenBalance", () => {
  const PID = "EuEkh8ZYkoPKXimgjre7W268XXX_qRn5vofc66oRTOw";
  const GATEWAY = "https://arweave.net";
  const SFC = "https://state.forward.computer";
  const NEO = "https://alpha.neo.zephyrdev.xyz";

  function routed(answers: Record<string, () => Response>): { fetchImpl: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const key = Object.keys(answers).find((prefix) => url.startsWith(prefix));
      return key ? answers[key]!() : new Response("x", { status: 500 });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it("reads an L1 token from the gateway's HyperBEAM before the peer", async () => {
    const { fetchImpl, calls } = routed({ [GATEWAY]: () => Response.json("1000000000000") });
    const quantity = await readTokenBalance({ processId: PID, address: ADDRESS, transport: "l1", gatewayUrl: GATEWAY, peerUrl: SFC, fetchImpl });
    expect(quantity).toBe("1000000000000");
    expect(calls).toEqual([`${GATEWAY}/${PID}~process@1.0/compute/balances/${ADDRESS}`]);
  });

  it("doesn't take a gateway 404 for a zero: it asks the token nodes", async () => {
    const { fetchImpl } = routed({
      [GATEWAY]: () => new Response("<html>404</html>", { status: 404 }),
      [NEO]: () => Response.json("500000000000"),
    });
    const quantity = await readTokenBalance({ processId: PID, address: ADDRESS, transport: "l1", gatewayUrl: GATEWAY, peerUrl: SFC, fetchImpl });
    expect(quantity).toBe("500000000000");
  });

  it("reads a token node's 404 as never credited, whatever the legacy peer answers", async () => {
    const { fetchImpl } = routed({
      [GATEWAY]: () => new Response("x", { status: 404 }),
      [NEO]: () => new Response("x", { status: 404 }),
      [SFC]: () => new Response("Forbidden", { status: 403 }),
    });
    const quantity = await readTokenBalance({ processId: PID, address: ADDRESS, transport: "l1", gatewayUrl: GATEWAY, peerUrl: SFC, fetchImpl });
    expect(quantity).toBe("0");
  });

  it("fails rather than report 0 on a gateway 404 alone", async () => {
    const { fetchImpl } = routed({
      [GATEWAY]: () => new Response("x", { status: 404 }),
      [NEO]: () => new Response("x", { status: 502 }),
      [SFC]: () => new Response("Forbidden", { status: 403 }),
    });
    await expect(
      readTokenBalance({ processId: PID, address: ADDRESS, transport: "l1", gatewayUrl: GATEWAY, peerUrl: SFC, fetchImpl, label: "lldex" }),
    ).rejects.toThrow(/lldex.*arweave\.net \(HTTP 404\)/);
  });

  it("falls back from a 403ing peer to the CU dry-run for a legacy token", async () => {
    const { fetchImpl, calls } = routed({
      [SFC]: () => new Response("Forbidden", { status: 403 }),
      "https://cu.ao-testnet.xyz/dry-run": () => Response.json({ Messages: [{ Data: "77", Tags: [] }] }),
    });
    const quantity = await readTokenBalance({ processId: PID, address: ADDRESS, transport: "mu", gatewayUrl: GATEWAY, peerUrl: SFC, fetchImpl });
    expect(quantity).toBe("77");
    expect(calls.some((url) => new URL(url).origin === new URL(GATEWAY).origin)).toBe(false);
  });

  it("names every source and its status when none answers", async () => {
    const { fetchImpl } = routed({ [SFC]: () => new Response("Forbidden", { status: 403 }) });
    await expect(
      readTokenBalance({ processId: PID, address: ADDRESS, transport: "l1", gatewayUrl: GATEWAY, peerUrl: SFC, fetchImpl, label: "FODDER" }),
    ).rejects.toThrow(
      "Couldn't read your FODDER balance. Tried arweave.net (HTTP 500), alpha.neo.zephyrdev.xyz (HTTP 500), charlie.neo2.zephyrdev.xyz (HTTP 500), state.forward.computer (HTTP 403).",
    );
  });
});
