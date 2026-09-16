import { describe, expect, it } from "vitest";
import { PERMISSION_TYPES } from "./permission";
import type { Grant } from "./grant";
import type { ActivityEntry } from "./activity";
import type { ApprovalRequest } from "./approval";
import type { Wallet } from "./wallet";
import type { AoTokenTransferRequest, AoTokenTransferResult, TransferDraft } from "./transfer";
import type { ThemeSettings } from "./theme";
import type { PortfolioHistory } from "./portfolio-history";

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

  it("an ActivityEntry with no token field is representable (AR, pre-existing producers)", () => {
    const entry: ActivityEntry = {
      txId: "tx-1",
      type: "send",
      status: "pending",
      address: "abc",
      amount: "1000000000000",
      tags: [],
      timestamp: 0,
    };
    expect(entry.token).toBeUndefined();
  });

  it("an ActivityEntry's token distinguishes an AO transfer from an AR one and from another token", () => {
    const arEntry: ActivityEntry = {
      txId: "tx-ar",
      type: "send",
      status: "pending",
      address: "abc",
      amount: "1000",
      tags: [],
      timestamp: 0,
      token: null,
    };
    const aoEntryA: ActivityEntry = {
      txId: "tx-ao-a",
      type: "send",
      status: "pending",
      address: "abc",
      amount: "1000",
      tags: [],
      timestamp: 0,
      token: "process-a",
    };
    const aoEntryB: ActivityEntry = {
      ...aoEntryA,
      txId: "tx-ao-b",
      token: "process-b",
    };

    expect(arEntry.token).toBeNull();
    expect(aoEntryA.token).not.toBe(aoEntryB.token);
    expect(aoEntryA.token).not.toBe(arEntry.token);
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

  it("an AoTokenTransferRequest carries the token processId, recipient, and atomic-string amount", () => {
    const request: AoTokenTransferRequest = {
      token: "ao-process-id",
      recipient: "abc",
      amount: "1000",
    };
    expect(typeof request.amount).toBe("string");
    expect(request.token).toBe("ao-process-id");
  });

  it("an AoTokenTransferResult carries the submitted message id under `id`, mirroring dispatch()'s response shape", () => {
    const result: AoTokenTransferResult = { id: "message-id-1" };
    expect(result.id).toBe("message-id-1");
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
        token: null,
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

  it("a transferAoTokens ApprovalRequest preview identifies the token being sent", () => {
    const request: ApprovalRequest = {
      requestId: "req-3",
      kind: "transferAoTokens",
      origin: "https://example.com",
      createdAt: 0,
      preview: {
        kind: "transferAoTokens",
        recipient: "abc",
        amount: "1000",
        fee: null,
        token: "ao-process-id",
        decodedData: null,
        tags: [],
        payloadHash: "deadbeef",
      },
    };
    expect(request.preview.kind).toBe("transferAoTokens");
    if (request.preview.kind !== "connect") {
      expect(request.preview.token).toBe("ao-process-id");
    }
  });

  it("a PortfolioHistory with an empty series still carries a range and label", () => {
    const history: PortfolioHistory = {
      range: "7D",
      series: [],
      currentUsdValue: 0,
      usdChange: 0,
      periodLabel: "Last 7 days",
    };
    expect(history.series).toEqual([]);
    expect(history.range).toBe("7D");
  });

  it("a PortfolioHistory's usdChange is a fraction, not a pre-formatted string", () => {
    const history: PortfolioHistory = {
      range: "24H",
      series: [{ timestamp: 0, usdValue: 100 }],
      currentUsdValue: 104.21,
      usdChange: 0.0421,
      periodLabel: "Last 24 hours",
    };
    expect(typeof history.usdChange).toBe("number");
  });
});
