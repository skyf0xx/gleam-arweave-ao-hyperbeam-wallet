import { describe, expect, it } from "vitest";
import type { SigningApprovalPreview } from "@gleam/core";
import { HIDDEN_AMOUNT } from "@gleam/ui/src/format/currency.ts";
import { t } from "../i18n";
import {
  amountText,
  balanceAfterParts,
  feeFiatText,
  feeText,
  fiatText,
  glyphLabel,
  groupDigits,
  isUnknownScale,
  recipientsOf,
  showsWarning,
  transferRequestFromDevice,
  warningReasons,
  transferRequestFromPreview,
  type TransferRequest,
} from "./model";

const R = "r".repeat(43);
const P = "p".repeat(43);

const BASE: SigningApprovalPreview = {
  kind: "dispatch",
  recipient: R,
  amount: "5",
  fee: "1",
  token: null,
  tokenDenomination: null,
  tokenTicker: null,
  decodedData: null,
  tags: [],
  payloadHash: "h",
  items: null,
};

function request(overrides: Partial<TransferRequest["transfers"][number]> = {}, fee: string | null = "1"): TransferRequest {
  return {
    transfers: [
      { token: null, ticker: "AR", denomination: 12, amount: "5", recipient: R, part: { tags: [], decodedData: null, payloadHash: null }, index: 0, ...overrides },
    ],
    others: [],
    fee,
    method: null,
    itemCount: 1,
  };
}

describe("groupDigits", () => {
  it("groups by thousands with narrow no-break spaces", () => {
    expect(groupDigits("1500000")).toBe("1 500 000");
    expect(groupDigits("999")).toBe("999");
  });
});

describe("transferRequestFromPreview", () => {
  it("reads an AR send at 12 decimals and keeps its payload hash", () => {
    const parsed = transferRequestFromPreview(BASE)!;
    expect(parsed.transfers[0]).toMatchObject({ token: null, ticker: "AR", denomination: 12, amount: "5" });
    expect(parsed.transfers[0]!.part.payloadHash).toBe("h");
    expect(parsed.method).toBe("dispatch");
  });

  it("drops the payload hash of a wallet send and names no method", () => {
    const parsed = transferRequestFromPreview({ ...BASE, kind: "transfer" })!;
    expect(parsed.transfers[0]!.part.payloadHash).toBeNull();
    expect(parsed.method).toBeNull();
  });

  it("counts the tags an L1 token transfer's reader did not consume", () => {
    const parsed = transferRequestFromPreview({
      ...BASE,
      kind: "sign",
      token: P,
      tags: [
        { name: "action", value: "transfer" },
        { name: "recipient", value: R },
        { name: "quantity", value: "5" },
        { name: "X-Forward-To", value: P },
        { name: "Content-Type", value: "text/plain" },
      ],
    })!;
    expect(parsed.transfers[0]!.otherTags).toBe(1);
  });

  it("counts every non-protocol tag on an AR send", () => {
    const parsed = transferRequestFromPreview({ ...BASE, tags: [{ name: "Action", value: "Transfer" }] })!;
    expect(parsed.transfers[0]!.otherTags).toBe(1);
  });

  it("counts an AO item's tags beyond Action, Recipient and Quantity", () => {
    const tags = [
      { name: "Data-Protocol", value: "ao" },
      { name: "Action", value: "Transfer" },
      { name: "Recipient", value: R },
      { name: "Quantity", value: "5" },
      { name: "Assign-To", value: P },
    ];
    const parsed = transferRequestFromPreview({
      ...BASE,
      kind: "signDataItem",
      recipient: null,
      items: [
        {
          decodedData: null,
          tags,
          target: P,
          payloadHash: "h",
          transfer: { token: P, tokenTicker: null, tokenDenomination: null, amount: "5", recipient: R },
        },
      ],
    })!;
    expect(parsed.transfers[0]!.otherTags).toBe(1);
  });

  it("shows an AO item's transfer of 1 of a collectible as the collectible, not as 1 raw unit", () => {
    const tags = [
      { name: "Data-Protocol", value: "ao" },
      { name: "Action", value: "Transfer" },
      { name: "Recipient", value: R },
      { name: "Quantity", value: "1" },
    ];
    const parsed = transferRequestFromPreview({
      ...BASE,
      kind: "signDataItem",
      recipient: null,
      items: [
        {
          decodedData: null,
          tags,
          target: P,
          payloadHash: "h",
          transfer: { token: P, tokenTicker: null, tokenDenomination: null, amount: "1", recipient: R, collectible: { id: P } },
        },
      ],
    })!;
    const line = parsed.transfers[0]!;
    expect(line.collectible).toEqual({ id: P });
    expect(amountText(line)).toBe("1");
    expect(isUnknownScale(line)).toBe(false);
    expect(showsWarning(parsed, null)).toBe(false);
  });

  it("keeps an AO item's transfer of 1 of an unresolved token as raw units", () => {
    const parsed = transferRequestFromPreview({
      ...BASE,
      kind: "signDataItem",
      recipient: null,
      items: [
        {
          decodedData: null,
          tags: [],
          target: P,
          payloadHash: "h",
          transfer: { token: P, tokenTicker: null, tokenDenomination: null, amount: "1", recipient: R },
        },
      ],
    })!;
    expect(parsed.transfers[0]!.collectible).toBeUndefined();
    expect(isUnknownScale(parsed.transfers[0]!)).toBe(true);
    expect(showsWarning(parsed, null)).toBe(true);
  });

  it("shows a transferAoTokens of 1 of a collectible as the collectible", () => {
    const parsed = transferRequestFromPreview({
      ...BASE,
      kind: "transferAoTokens",
      token: P,
      tokenDenomination: null,
      tokenTicker: null,
      amount: "1",
      collectible: { id: P },
    })!;
    expect(parsed.transfers[0]).toMatchObject({ token: P, amount: "1", collectible: { id: P } });
    expect(isUnknownScale(parsed.transfers[0]!)).toBe(false);
    expect(showsWarning(parsed, null)).toBe(false);
  });

  it("is null for a request that moves nothing", () => {
    expect(transferRequestFromPreview({ ...BASE, recipient: null })).toBeNull();
    expect(
      transferRequestFromPreview({
        ...BASE,
        kind: "signDataItem",
        recipient: null,
        items: [{ decodedData: null, tags: [], target: null, payloadHash: "x", transfer: null }],
      }),
    ).toBeNull();
  });
});

describe("transferRequestFromDevice", () => {
  it("is null when any payload moves nothing", () => {
    expect(transferRequestFromDevice([{ kind: "dataItem", target: null, dataSize: 3 }], undefined, null)).toBeNull();
  });

  it("scales only the token the preview resolved, and sums the AR fees", () => {
    const parsed = transferRequestFromDevice(
      [
        { kind: "l1TokenTransfer", process: P, recipient: R, quantity: "10", fee: "2" },
        { kind: "aoTransfer", process: "z".repeat(43), recipient: R, quantity: "3" },
      ],
      { processId: P, denomination: 1, ticker: "TOK" },
      null,
    )!;
    expect(parsed.transfers.map((transfer) => transfer.denomination)).toEqual([1, null]);
    expect(parsed.fee).toBe("2");
    expect(recipientsOf(parsed)).toEqual([R]);
  });

  it("shows an AO transfer of 1 as the collectible the preview named, and nothing else as one", () => {
    const parsed = transferRequestFromDevice(
      [{ kind: "aoTransfer", process: P, recipient: R, quantity: "1" }],
      undefined,
      { id: P },
    )!;
    expect(parsed.transfers[0]).toMatchObject({ token: P, amount: "1", collectible: { id: P } });
    expect(isUnknownScale(parsed.transfers[0]!)).toBe(false);
    expect(parsed.fee).toBeNull();

    const more = transferRequestFromDevice(
      [{ kind: "aoTransfer", process: P, recipient: R, quantity: "5" }],
      undefined,
      { id: P },
    )!;
    expect(more.transfers[0]!.collectible).toBeUndefined();

    const other = transferRequestFromDevice(
      [{ kind: "aoTransfer", process: "z".repeat(43), recipient: R, quantity: "1" }],
      undefined,
      { id: P },
    )!;
    expect(other.transfers[0]!.collectible).toBeUndefined();
  });
});

describe("balanceAfterParts", () => {
  it("takes the amount and the fee off an AR balance", () => {
    expect(balanceAfterParts({ balances: { arBalance: "1000000000000", tokenBalances: [] } }, request({ amount: "400000000000" }, "100000000000"))).toEqual([
      { amount: "0.5", ticker: "AR" },
    ]);
  });

  it("keeps a token's ticker apart from its amount, and leaves a ticker that echoes the id out", () => {
    const context = {
      balances: {
        arBalance: "0",
        tokenBalances: [
          { address: R, processId: P, ticker: "\u202EXYZ", denomination: 6, name: "X", quantity: "5000000", source: "watched" as const },
        ],
      },
    };
    expect(balanceAfterParts(context, request({ token: P, ticker: "\u202EXYZ", denomination: 6, amount: "2500000" }, null))).toEqual([
      { amount: "2.5", ticker: "\u202EXYZ" },
    ]);
    expect(balanceAfterParts(context, request({ token: P, ticker: P, denomination: 6, amount: "2500000" }, null))).toEqual([
      { amount: "2.5", ticker: null },
    ]);
    expect(balanceAfterParts(context, request({ token: P, ticker: "  ", denomination: 6, amount: "2500000" }, null))).toEqual([
      { amount: "2.5", ticker: null },
    ]);
  });

  it("masks every amount while balances are hidden", () => {
    expect(balanceAfterParts({ balances: { arBalance: "1000000000000", tokenBalances: [] }, balancesHidden: true }, request())).toEqual([
      { amount: HIDDEN_AMOUNT, ticker: null },
    ]);
  });

  it("leaves out a balance the request would overdraw", () => {
    expect(balanceAfterParts({ balances: { arBalance: "5", tokenBalances: [] } }, request())).toBeUndefined();
  });
});

describe("glyphLabel", () => {
  it("drops hidden characters from a ticker's initials", () => {
    expect(glyphLabel({ token: P, ticker: "\u202Exyz", denomination: 6, amount: "1", recipient: R })).toBe("XY");
    expect(glyphLabel({ token: P, ticker: "\u202E\u200B", denomination: 6, amount: "1", recipient: R })).toBe("?");
    expect(glyphLabel({ token: P, ticker: " \u202E ", denomination: 6, amount: "1", recipient: R })).toBe("?");
  });
});

describe("showsWarning", () => {
  it("warns for an unknown scale even without a recipient risk", () => {
    expect(showsWarning(request({ token: P, denomination: null }), null)).toBe(true);
    expect(showsWarning(request(), null)).toBe(false);
    expect(showsWarning(request(), { firstTime: false, lookalikeOf: null, unchecked: true })).toBe(true);
  });

  it("warns for a token transfer the wallet couldn't read, from the preview or the device", () => {
    const fromPreview = transferRequestFromPreview({ ...BASE, unreadableTokenTransfer: true })!;
    expect(showsWarning(fromPreview, null)).toBe(true);
    expect(warningReasons(fromPreview, t)).toEqual(["This may be a token transfer Gleam can't read. Check the tags."]);
    const fromDevice = transferRequestFromDevice(
      [{ kind: "transaction", recipient: P, quantity: "0", fee: "1", dataSize: "0", unreadableTokenTransfer: true }],
      undefined,
      null,
    )!;
    expect(showsWarning(fromDevice, null)).toBe(true);
    expect(showsWarning(transferRequestFromPreview(BASE)!, null)).toBe(false);
  });

  it("warns for a batch when any data item is a token transfer the wallet couldn't read", () => {
    const item = { decodedData: null, tags: [], target: P, payloadHash: "h" };
    const transfer = { token: P, recipient: R, amount: "5", tokenDenomination: 12, tokenTicker: "T" };
    const batch = (unreadable: boolean): SigningApprovalPreview => ({
      ...BASE,
      kind: "batchSignDataItem",
      items: [
        { ...item, transfer },
        { ...item, transfer: null, ...(unreadable ? { unreadableTokenTransfer: true } : {}) },
      ],
    });
    const warned = transferRequestFromPreview(batch(true))!;
    expect(warned.unreadableTokenTransfer).toBe(true);
    expect(warned.others).toEqual([expect.objectContaining({ index: 1, unreadableTokenTransfer: true })]);
    expect(showsWarning(warned, null)).toBe(true);
    expect(showsWarning(transferRequestFromPreview(batch(false))!, null)).toBe(false);
  });
});

describe("feeText", () => {
  it("rounds up to three significant digits", () => {
    expect(feeText("42855127", t)).toBe("0.0000429 AR");
    expect(feeText("42800000", t)).toBe("0.0000428 AR");
    expect(feeText("1", t)).toBe("0.000000000001 AR");
  });

  it("says None for a request with no fee", () => {
    expect(feeText(null, t)).toBe(t("transferReview.none"));
  });
});

describe("fiat values", () => {
  const context = { currency: "USD" as const, prices: [{ processId: null, price: 5, change24h: null }] };

  it("shows a tiny nonzero value as under one cent", () => {
    expect(fiatText(context, request({ amount: "1000000000" }).transfers[0]!)).toBe("< $0.01");
    expect(feeFiatText("42855127", context)).toBe("< $0.01");
  });

  it("keeps the estimate for larger values", () => {
    expect(fiatText(context, request({ amount: "2000000000000" }).transfers[0]!)).toBe("≈ $10.00");
  });

  it("leaves the fee unpriced when the display currency is AR", () => {
    expect(feeFiatText("42855127", { ...context, currency: "AR" })).toBeUndefined();
  });
});
