import { describe, expect, expectTypeOf, it } from "vitest";
import type { ProtocolMap } from "./protocol";

/**
 * `ProtocolMap` is a type-only contract — there is no runtime dispatcher to
 * exercise at this layer (that's a later layer's job). These are
 * type-shape assertions: they fail to compile (and so fail `vitest`'s
 * type-checked run) if a method signature drifts from ARCHITECTURE.md
 * §4.1, which is the actual risk this file guards against.
 */
describe("ProtocolMap", () => {
  it("declares wallet methods", () => {
    const methodNames: Array<keyof ProtocolMap> = [
      "createWallet",
      "importWallet",
      "deleteWallet",
      "renameWallet",
      "switchWallet",
      "exportWallet",
      "lockWallet",
      "unlockWallet",
      "getState",
      "getBalance",
      "getTokenBalances",
      "getActivity",
      "getConnectedApps",
      "estimateTransfer",
      "submitTransfer",
      "reviewUpload",
      "submitUpload",
      "getApproval",
      "resolveApproval",
      "setNetworkSettings",
      "setLockSettings",
      "getThemePreference",
      "setThemePreference",
      "revokeGrant",
      "listContacts",
      "saveContact",
      "deleteContact",
    ];
    expect(methodNames.length).toBe(27);
    expect(new Set(methodNames).size).toBe(methodNames.length);
  });

  it("createWallet returns a WalletSummary, never the encrypted keyfile", () => {
    expectTypeOf<ReturnType<ProtocolMap["createWallet"]>>().not.toHaveProperty(
      "encryptedKeyfile",
    );
  });

  it("getBalance returns a Winston string, never a number", () => {
    expectTypeOf<ReturnType<ProtocolMap["getBalance"]>>().toEqualTypeOf<string>();
  });

  it("exportWallet requires a password", () => {
    expectTypeOf<Parameters<ProtocolMap["exportWallet"]>[0]>().toHaveProperty(
      "password",
    );
  });

  it("resolveApproval takes a requestId and an approved boolean", () => {
    expectTypeOf<Parameters<ProtocolMap["resolveApproval"]>[0]>().toEqualTypeOf<{
      requestId: string;
      approved: boolean;
    }>();
  });

  it("getThemePreference/setThemePreference are exactly light or dark, never a system/auto value", () => {
    expectTypeOf<ReturnType<ProtocolMap["getThemePreference"]>>().toEqualTypeOf<{
      theme: "light" | "dark";
    }>();
    expectTypeOf<Parameters<ProtocolMap["setThemePreference"]>[0]>().toEqualTypeOf<{
      theme: "light" | "dark";
    }>();
  });

  it("getPortfolioHistory takes one of the 5 range tabs and returns the series plus its precomputed summary", () => {
    expectTypeOf<Parameters<ProtocolMap["getPortfolioHistory"]>[0]>().toEqualTypeOf<{
      range: "24H" | "7D" | "1M" | "1Y" | "ALL";
    }>();
    expectTypeOf<
      ReturnType<ProtocolMap["getPortfolioHistory"]>
    >().toHaveProperty("series");
    expectTypeOf<
      ReturnType<ProtocolMap["getPortfolioHistory"]>
    >().toHaveProperty("currentUsdValue");
    expectTypeOf<
      ReturnType<ProtocolMap["getPortfolioHistory"]>
    >().toHaveProperty("usdChange");
    expectTypeOf<
      ReturnType<ProtocolMap["getPortfolioHistory"]>
    >().toHaveProperty("periodLabel");
  });
});
