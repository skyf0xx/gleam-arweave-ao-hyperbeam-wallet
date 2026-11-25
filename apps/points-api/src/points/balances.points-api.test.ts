// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createBalanceReader } from "./balances";

const AO_PROCESS = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";

function stubFetch(routes: Record<string, { status: number; body: string }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)];
    if (!route) throw new Error(`unexpected fetch ${String(input)}`);
    return new Response(route.body, { status: route.status });
  }) as unknown as typeof fetch;
}

const config = { arweaveGatewayUrl: "https://gw.example", hyperbeamUrl: "https://hb.example/" };

describe("createBalanceReader", () => {
  it("reads AR from the gateway and AO from HyperBEAM", async () => {
    const read = createBalanceReader({
      ...config,
      fetchImpl: stubFetch({
        "https://gw.example/wallet/addr/balance": { status: 200, body: "123" },
        [`https://hb.example/${AO_PROCESS}~process@1.0/compute/balances/addr`]: { status: 200, body: "456" },
      }),
    });

    expect(await read("addr")).toEqual({ arAtomic: "123", aoAtomic: "456" });
  });

  it("treats HyperBEAM's 404 for an uncredited address as 0 AO", async () => {
    const read = createBalanceReader({
      ...config,
      fetchImpl: stubFetch({
        "https://gw.example/wallet/addr/balance": { status: 200, body: "0" },
        [`https://hb.example/${AO_PROCESS}~process@1.0/compute/balances/addr`]: { status: 404, body: "<html>" },
      }),
    });

    expect(await read("addr")).toEqual({ arAtomic: "0", aoAtomic: "0" });
  });

  it("fails on any other HyperBEAM error or a non-integer body", async () => {
    const failing = (status: number, body: string) =>
      createBalanceReader({
        ...config,
        fetchImpl: stubFetch({
          "https://gw.example/wallet/addr/balance": { status: 200, body: "0" },
          [`https://hb.example/${AO_PROCESS}~process@1.0/compute/balances/addr`]: { status, body },
        }),
      })("addr");

    await expect(failing(502, "")).rejects.toThrow(/502/);
    await expect(failing(200, "1.5")).rejects.toThrow(/integer/);
  });
});
