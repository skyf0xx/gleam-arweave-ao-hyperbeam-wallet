import { describe, expect, it, vi } from "vitest";
import { getTokenBalance, readTokenBalance } from "./balance";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
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

  it("refuses an oversized balance reply without buffering it", async () => {
    const fetchImpl = vi.fn(async () => new Response(`"${"9".repeat(100_000)}"`)) as unknown as typeof fetch;
    await expect(getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl)).rejects.toThrow();
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
    const fetchImpl = fakeFetch(null, 404);
    const result = await getTokenBalance(PROCESS_ID, ADDRESS, PEER, fetchImpl);

    expect(result.quantity).toBe("0");
    expect(result.denomination).toBe(12);
  });

  it("throws on a non-2xx response (peer down)", async () => {
    const fetchImpl = fakeFetch(null, 502);
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

  const l1 = { processId: PID, address: ADDRESS, transport: "l1" as const, gatewayUrl: GATEWAY, peerUrl: SFC };

  it("reads an L1 token from the gateway's HyperBEAM before the peer", async () => {
    const { fetchImpl, calls } = routed({ [GATEWAY]: () => new Response("1000000000000") });
    await expect(readTokenBalance({ ...l1, fetchImpl })).resolves.toBe("1000000000000");
    expect(calls.filter((url) => url.includes("/now/as/balance"))).toEqual([`${GATEWAY}/${PID}~process@1.0/now/as/balance?as=execution&balance=${ADDRESS}`]);
  });

  it("reads from the host that has scheduled the most for the process, not a lagging gateway", async () => {
    const { fetchImpl, calls } = routed({
      [`${GATEWAY}/${PID}~process@1.0/slot/current`]: () => new Response("0"),
      [`${NEO}/${PID}~process@1.0/slot/current`]: () => new Response("1"),
      [GATEWAY]: () => new Response("1"),
      [NEO]: () => new Response("0"),
    });
    await expect(readTokenBalance({ ...l1, fetchImpl })).resolves.toBe("0");
    expect(calls.filter((url) => url.includes("/now/as/balance"))).toEqual([`${NEO}/${PID}~process@1.0/now/as/balance?as=execution&balance=${ADDRESS}`]);
  });

  it("asks hosts at the same slot together, so one that hangs on the balance holds nothing up", async () => {
    const aborted: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/slot/current")) return new Response("3");
      if (url.startsWith(NEO)) return new Response("42");
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => {
          aborted.push(new URL(url).origin);
          reject(new DOMException("aborted", "AbortError"));
        }),
      );
    }) as typeof fetch;
    const started = Date.now();
    await expect(readTokenBalance({ ...l1, fetchImpl })).resolves.toBe("42");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(aborted).toContain(GATEWAY);
  });

  it("never lets a faster host with a lower slot win", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const ahead = url.startsWith(GATEWAY);
      if (url.endsWith("/slot/current")) return new Response(ahead ? "4" : "3");
      if (ahead) await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(ahead ? "2" : "1");
    }) as typeof fetch;
    await expect(readTokenBalance({ ...l1, fetchImpl })).resolves.toBe("2");
  });

  it("stops waiting for a host that hangs on its slot", async () => {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(NEO) && url.endsWith("/slot/current")) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))));
      }
      return new Response(url.endsWith("/slot/current") ? "3" : "42");
    }) as typeof fetch;
    const started = Date.now();
    await expect(readTokenBalance({ ...l1, fetchImpl })).resolves.toBe("42");
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("keeps a balance past Number.MAX_SAFE_INTEGER exact", async () => {
    const { fetchImpl } = routed({ [GATEWAY]: () => new Response("20999629495219345476") });
    await expect(readTokenBalance({ ...l1, fetchImpl })).resolves.toBe("20999629495219345476");
  });

  it("reads an address the token never credited as the node's 0", async () => {
    const { fetchImpl } = routed({ [GATEWAY]: () => new Response("0") });
    await expect(readTokenBalance({ ...l1, fetchImpl })).resolves.toBe("0");
  });

  it("doesn't take a gateway's HTML 200 for a balance: it asks the token nodes", async () => {
    const { fetchImpl } = routed({
      [GATEWAY]: () => new Response("<!DOCTYPE html><html></html>", { status: 200 }),
      [NEO]: () => new Response("500000000000"),
    });
    await expect(readTokenBalance({ ...l1, fetchImpl })).resolves.toBe("500000000000");
  });

  it("doesn't take a 404 for a zero: it asks the token nodes", async () => {
    const { fetchImpl } = routed({
      [GATEWAY]: () => new Response("x", { status: 404 }),
      [NEO]: () => new Response("500000000000"),
    });
    await expect(readTokenBalance({ ...l1, fetchImpl })).resolves.toBe("500000000000");
  });

  it("fails rather than report 0 when every host answers 404", async () => {
    const { fetchImpl } = routed({
      [GATEWAY]: () => new Response("x", { status: 404 }),
      [NEO]: () => new Response("x", { status: 404 }),
      [SFC]: () => new Response("Forbidden", { status: 403 }),
    });
    await expect(readTokenBalance({ ...l1, fetchImpl, label: "lldex" })).rejects.toThrow(/lldex.*arweave\.net \(HTTP 404\)/);
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
      "Couldn't read your FODDER balance. Tried arweave.net (HTTP 500), alpha.neo.zephyrdev.xyz (HTTP 500), charlie.neo2.zephyrdev.xyz (HTTP 500), hb.arweave.net (HTTP 500), up.arweave.net (HTTP 500), state.forward.computer (HTTP 403).",
    );
  });
});
