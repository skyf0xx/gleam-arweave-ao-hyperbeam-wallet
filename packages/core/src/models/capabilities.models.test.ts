import { describe, expect, it } from "vitest";
import { capabilitiesFor, capabilityRefusal, providerMethodRefusal } from "./capabilities";
import { PROVIDER_METHODS } from "./method-privileges";

describe("capabilitiesFor", () => {
  it("lets a keyfile wallet do everything", () => {
    expect(Object.values(capabilitiesFor("jwk")).every(Boolean)).toBe(true);
  });

  it("lets Keystone sign transactions, data items and messages, but not key operations", () => {
    expect(capabilitiesFor("keystone")).toEqual({
      signTransaction: true,
      dispatchViaBundler: true,
      signDataItem: true,
      signMessage: true,
      decrypt: false,
      exportKey: false,
      encrypt: true,
      points: true,
    });
  });

  it("lets Ledger sign transactions and data items, with dispatch on L1", () => {
    expect(capabilitiesFor("ledger")).toEqual({
      signTransaction: true,
      dispatchViaBundler: false,
      signDataItem: true,
      signMessage: false,
      decrypt: false,
      exportKey: false,
      encrypt: true,
      points: true,
    });
  });

  it("gives an ethereum wallet no Arweave capability", () => {
    expect(Object.values(capabilitiesFor("ethereum")).some(Boolean)).toBe(false);
  });

  it("gives a watch wallet no capability at all", () => {
    expect(Object.values(capabilitiesFor("watch")).some(Boolean)).toBe(false);
  });
});

describe("providerMethodRefusal", () => {
  it("refuses nothing for a keyfile wallet", () => {
    for (const method of PROVIDER_METHODS) expect(providerMethodRefusal("jwk", method)).toBeNull();
  });

  it("names the operation a hardware wallet can't do", () => {
    expect(providerMethodRefusal("ledger", "signMessage")).toBe(
      "This wallet can't sign messages. Switch to a keyfile wallet.",
    );
    expect(providerMethodRefusal("keystone", "decrypt")).toBe(
      "This wallet can't decrypt data. Switch to a keyfile wallet.",
    );
  });

  it("allows what a hardware wallet can sign", () => {
    for (const method of ["sign", "dispatch", "signDataItem", "batchSignDataItem", "transferAoTokens", "signMessage", "encrypt"] as const) {
      expect(providerMethodRefusal("keystone", method)).toBeNull();
    }
    for (const method of ["sign", "dispatch", "signDataItem", "batchSignDataItem", "transferAoTokens", "encrypt"] as const) {
      expect(providerMethodRefusal("ledger", method)).toBeNull();
    }
  });

  it("says a watch wallet is watch-only", () => {
    expect(providerMethodRefusal("watch", "sign")).toBe("This wallet is watch-only, so it can't sign transactions.");
    expect(capabilityRefusal("watch", "signTransaction", "send AR")).toBe("This wallet is watch-only, so it can't send AR.");
  });

  it("never refuses a method that signs nothing", () => {
    for (const method of ["connect", "getActiveAddress", "verifyMessage", "tokenBalance"] as const) {
      expect(providerMethodRefusal("ethereum", method)).toBeNull();
    }
  });
});

describe("capabilityRefusal", () => {
  it("is null when the wallet has the capability", () => {
    expect(capabilityRefusal("keystone", "signDataItem", "send AO")).toBeNull();
  });

  it("names the action for a wallet without it", () => {
    expect(capabilityRefusal("ledger", "exportKey", "export its key")).toBe(
      "This wallet can't export its key. Switch to a keyfile wallet.",
    );
  });
});
