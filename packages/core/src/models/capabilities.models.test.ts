import { describe, expect, it } from "vitest";
import { capabilitiesFor, providerMethodRefusal } from "./capabilities";
import { PROVIDER_METHODS } from "./method-privileges";

describe("capabilitiesFor", () => {
  it("lets a keyfile wallet do everything", () => {
    expect(Object.values(capabilitiesFor("jwk")).every(Boolean)).toBe(true);
  });

  it("lets Keystone sign transactions and data items, but not messages or key operations", () => {
    expect(capabilitiesFor("keystone")).toEqual({
      signTransaction: true,
      dispatchViaBundler: true,
      signDataItem: true,
      signMessage: false,
      decrypt: false,
      privateHash: false,
      exportKey: false,
      encrypt: true,
      upload: false,
      points: false,
    });
  });

  it("keeps Ledger dispatch on L1", () => {
    expect(capabilitiesFor("ledger")).toEqual({
      signTransaction: true,
      dispatchViaBundler: false,
      signDataItem: true,
      signMessage: false,
      decrypt: false,
      privateHash: false,
      exportKey: false,
      encrypt: true,
      upload: false,
      points: false,
    });
  });

  it("gives an ethereum wallet no Arweave capability", () => {
    expect(Object.values(capabilitiesFor("ethereum")).some(Boolean)).toBe(false);
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
    expect(providerMethodRefusal("keystone", "signature")).toBe(
      "This wallet can't sign messages. Switch to a keyfile wallet.",
    );
    expect(providerMethodRefusal("keystone", "decrypt")).toBe(
      "This wallet can't decrypt data. Switch to a keyfile wallet.",
    );
    expect(providerMethodRefusal("ledger", "privateHash")).toBe(
      "This wallet can't create private hashes. Switch to a keyfile wallet.",
    );
  });

  it("allows what a hardware wallet can sign", () => {
    for (const method of ["sign", "dispatch", "signDataItem", "batchSignDataItem", "transferAoTokens", "encrypt"] as const) {
      expect(providerMethodRefusal("keystone", method)).toBeNull();
      expect(providerMethodRefusal("ledger", method)).toBeNull();
    }
  });

  it("never refuses a method that signs nothing", () => {
    for (const method of ["connect", "getActiveAddress", "verifyMessage", "tokenBalance"] as const) {
      expect(providerMethodRefusal("ethereum", method)).toBeNull();
    }
  });
});
