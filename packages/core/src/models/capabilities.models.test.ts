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
      upload: false,
      points: true,
    });
  });

  it("lets Ledger sign AR transactions only, with dispatch on L1", () => {
    expect(capabilitiesFor("ledger")).toEqual({
      signTransaction: true,
      dispatchViaBundler: false,
      signDataItem: false,
      signMessage: false,
      decrypt: false,
      exportKey: false,
      encrypt: true,
      upload: false,
      points: true,
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
    expect(providerMethodRefusal("keystone", "decrypt")).toBe(
      "This wallet can't decrypt data. Switch to a keyfile wallet.",
    );
  });

  it("allows what a hardware wallet can sign", () => {
    for (const method of ["sign", "dispatch", "signDataItem", "batchSignDataItem", "transferAoTokens", "signMessage", "encrypt"] as const) {
      expect(providerMethodRefusal("keystone", method)).toBeNull();
    }
    for (const method of ["sign", "dispatch", "encrypt"] as const) {
      expect(providerMethodRefusal("ledger", method)).toBeNull();
    }
  });

  it("points a Ledger to a Keystone for data items", () => {
    expect(providerMethodRefusal("ledger", "transferAoTokens")).toBe(
      "Ledger only supports sending AR for now, so it can't send AO tokens. Use a Keystone instead.",
    );
    expect(providerMethodRefusal("ledger", "signDataItem")).toBe(
      "Ledger only supports sending AR for now, so it can't sign data items. Use a Keystone instead.",
    );
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
    expect(capabilityRefusal("ledger", "signDataItem", "send AO")).toBe(
      "Ledger only supports sending AR for now, so it can't send AO. Use a Keystone instead.",
    );
    expect(capabilityRefusal("ledger", "upload", "upload files")).toBe(
      "This wallet can't upload files. Switch to a keyfile wallet.",
    );
  });
});
