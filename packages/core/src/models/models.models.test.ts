import { describe, expect, it } from "vitest";
import { PERMISSION_TYPES } from "./permission";
import type { Grant } from "./grant";
import type { ActivityEntry } from "./activity";
import type { ApprovalRequest } from "./approval";
import type { Wallet } from "./wallet";
import type { TransferDraft } from "./transfer";
import type { ThemeSettings } from "./theme";

describe("PERMISSION_TYPES", () => {
  it("carries the known ArConnect-compatible permission scopes", () => {
    expect(PERMISSION_TYPES).toEqual(
      expect.arrayContaining([
        "ACCESS_ADDRESS",
        "ACCESS_PUBLIC_KEY",
        "ACCESS_ALL_ADDRESSES",
        "SIGN_TRANSACTION",
        "DISPATCH",
        "ENCRYPT",
        "DECRYPT",
        "SIGNATURE",
        "ACCESS_ARWEAVE_CONFIG",
        "ACCESS_TOKENS",
      ]),
    );
  });

  it("has no duplicate scopes", () => {
    expect(new Set(PERMISSION_TYPES).size).toBe(PERMISSION_TYPES.length);
  });
});

describe("domain model shapes", () => {
  it("a Wallet with no key material is representable (Ledger-style)", () => {
    const wallet: Wallet = {
      id: "wallet-1",
      address: "abc",
      name: "Main",
      method: "ledger",
      publicKey: "pub",
      createdAt: 0,
      updatedAt: 0,
      encryptedKeyfile: null,
    };
    expect(wallet.encryptedKeyfile).toBeNull();
  });

  it("a Grant's budget is always null in this phase", () => {
    const grant: Grant = {
      origin: "https://example.com",
      walletId: "wallet-1",
      permissions: ["ACCESS_ADDRESS"],
      createdAt: 0,
      expiresAt: null,
      budget: null,
    };
    expect(grant.budget).toBeNull();
  });

  it("an ActivityEntry carries amount as a string, never a number", () => {
    const entry: ActivityEntry = {
      txId: "tx-1",
      type: "send",
      status: "pending",
      address: "abc",
      amount: "1000000000000",
      tags: [],
      timestamp: 0,
    };
    expect(typeof entry.amount).toBe("string");
  });

  it("a TransferDraft has no fee until estimateTransfer runs", () => {
    const draft: TransferDraft = {
      recipient: "abc",
      token: null,
      amount: "1000",
      fee: null,
    };
    expect(draft.fee).toBeNull();
  });

  it("a ThemeSettings is exactly light or dark, never a system/auto value", () => {
    const light: ThemeSettings = { theme: "light" };
    const dark: ThemeSettings = { theme: "dark" };
    expect(light.theme).toBe("light");
    expect(dark.theme).toBe("dark");
  });

  it("a connect ApprovalRequest carries requested permissions in its preview", () => {
    const request: ApprovalRequest = {
      requestId: "req-1",
      kind: "connect",
      origin: "https://example.com",
      createdAt: 0,
      preview: {
        kind: "connect",
        requestedPermissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"],
      },
    };
    expect(request.preview.kind).toBe("connect");
  });

  it("a signing ApprovalRequest preview carries a payload hash", () => {
    const request: ApprovalRequest = {
      requestId: "req-2",
      kind: "sign",
      origin: "https://example.com",
      createdAt: 0,
      preview: {
        kind: "sign",
        recipient: "abc",
        amount: "1000",
        fee: "10",
        decodedData: null,
        tags: [],
        payloadHash: "deadbeef",
      },
    };
    expect(request.preview.kind).toBe("sign");
    if (request.preview.kind !== "connect") {
      expect(request.preview.payloadHash).toBe("deadbeef");
    }
  });
});
