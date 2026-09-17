import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  TokenWireContract,
  WireTokenBalanceRequest,
  WireTokenBalanceResult,
  WireUserTokensRequest,
  WireUserTokensResult,
} from "./token-protocol";
import { PROVIDER_SURFACE_METHODS } from "./page-protocol";

/**
 * `TokenWireContract` is a type-only lookup — there is no runtime
 * dispatcher to exercise at this layer (that's `provider-bridge`'s job,
 * same as `signing-protocol.messaging.test.ts`'s own doc comment).
 */
describe("TokenWireContract", () => {
  it("covers both read-only token-query provider-surface methods", () => {
    const methods: Array<keyof TokenWireContract> = ["tokenBalance", "userTokens"];
    expect(methods.length).toBe(2);
    expect(new Set(methods).size).toBe(methods.length);
    for (const method of methods) {
      expect(PROVIDER_SURFACE_METHODS as readonly string[]).toContain(method);
    }
  });

  it("tokenBalance takes an { id } request and resolves to an atomic-unit string, never a number", () => {
    expectTypeOf<WireTokenBalanceRequest>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<WireTokenBalanceResult>().toEqualTypeOf<string>();

    const request: WireTokenBalanceRequest = { id: "ao-process-id" };
    const result: WireTokenBalanceResult = "1000000000000";
    expect(request.id).toBe("ao-process-id");
    expect(typeof result).toBe("string");
  });

  it("userTokens takes optional { cursor?, limit? } and resolves to a list of discovered tokens", () => {
    const noOptions: WireUserTokensRequest = {};
    const withOptions: WireUserTokensRequest = { cursor: "abc", limit: 10 };
    expect(noOptions.cursor).toBeUndefined();
    expect(withOptions.limit).toBe(10);

    const result: WireUserTokensResult = [
      {
        processId: "ao-process-id",
        Ticker: "wUSDC",
        Name: "Legacy wUSDC",
        Denomination: "6",
        Logo: "some-arweave-tx-id",
      },
      {
        processId: "another-process-id",
        Ticker: "AO",
        Name: "AO",
        Denomination: "12",
      },
    ];
    expect(result[0]?.Ticker).toBe("wUSDC");
    expect(result[1]?.Logo).toBeUndefined();
  });

  it("neither request shape carries a walletId/approval payload, unlike the signing contracts", () => {
    expectTypeOf<WireTokenBalanceRequest>().not.toHaveProperty("walletId");
    expectTypeOf<WireUserTokensRequest>().not.toHaveProperty("walletId");
  });
});
