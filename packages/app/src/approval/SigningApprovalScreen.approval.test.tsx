import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WALLET_APPROVAL_ORIGIN, type SigningApprovalPreview, type TokenBalance } from "@gleam/core";
import { DEFAULT_AO_TOKEN } from "@gleam/ui";
import { addressText } from "@gleam/ui/src/components/wallet/MemorableAddress.testing.ts";
import { formatCurrencyValue, HIDDEN_AMOUNT } from "@gleam/ui/src/format/currency.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { groupDigits, type TransferContext } from "../transfer-review/model";
import { SigningApprovalScreen, type SigningApprovalScreenProps } from "./SigningApprovalScreen";

afterEach(() => {
  cleanup();
});

/** The ticker is its own isolated run, so the row is read as a whole. */
function balanceAfterText(): string | null | undefined {
  return screen.getByText("Balance after").nextElementSibling?.textContent;
}

const RECIPIENT = "xU9zFq2wR7mN4tK8vB1jH6yE0sD3aC5fG9pLxU9k3kL";
const SECOND_RECIPIENT = "Lm8sQe3Rt5Yu7Io9Pa1Sd3Fg5Hj7Kl9Zx1Cv3Bn5Mq";
const FROM = { name: "Main", address: "Gx7cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAk2Qa" };
const AO = DEFAULT_AO_TOKEN.processId as string;
const WAR = "W".repeat(43);
const KNOWN = { firstTime: false, lookalikeOf: null };

// Winston atomic-integer strings, matching what the background puts on the
// wire: 50 AR and an 0.0008 AR fee.
const AR_PREVIEW: SigningApprovalPreview = {
  kind: "dispatch",
  recipient: RECIPIENT,
  amount: "50000000000000",
  fee: "800000000",
  token: null,
  tokenDenomination: null,
  tokenTicker: null,
  decodedData: null,
  tags: [],
  payloadHash: "7f3a2e9c1b6d4f80a5e2c7b91d3f6a8e0c4b7d2f9a1e6c3b8d5f0a2e7c9b4d1f",
  items: null,
};

const AO_PREVIEW: SigningApprovalPreview = {
  kind: "transferAoTokens",
  recipient: RECIPIENT,
  amount: "1500000000000",
  fee: null,
  token: AO,
  tokenDenomination: 12,
  tokenTicker: "AO",
  decodedData: "",
  tags: [
    { name: "Action", value: "Transfer" },
    { name: "Recipient", value: RECIPIENT },
  ],
  payloadHash: "1a9d4f7c2e5b8a0f3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c",
  items: null,
};

const MESSAGE_PREVIEW: SigningApprovalPreview = {
  kind: "signDataItem",
  recipient: null,
  amount: null,
  fee: null,
  token: null,
  tokenDenomination: null,
  tokenTicker: null,
  decodedData: '{"Action":"Eval"}',
  tags: [{ name: "Action", value: "Eval" }],
  payloadHash: "1a9d4f7c2e5b8a0f3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c",
  items: null,
};

function balance(processId: string, ticker: string, quantity: string, denomination = 12): TokenBalance {
  return { address: FROM.address, processId, ticker, denomination, name: ticker, quantity, source: "watched" };
}

const CONTEXT: TransferContext = {
  address: FROM.address,
  currency: "USD",
  tokenLogos: false,
  balances: {
    arBalance: "100000000000000",
    tokenBalances: [balance(AO, "AO", "12250000000000"), balance(WAR, "wAR", "1450000000000")],
  },
  prices: [
    { processId: null, price: 8.7, change24h: null },
    { processId: AO, price: 8.4, change24h: null },
    { processId: WAR, price: 8.72, change24h: null },
  ],
};

function renderScreen(props: Partial<SigningApprovalScreenProps> & { preview: SigningApprovalPreview }) {
  const all: SigningApprovalScreenProps = {
    origin: "https://dapp.example",
    assessment: KNOWN,
    from: FROM,
    context: CONTEXT,
    onReject: vi.fn(),
    onSign: vi.fn().mockResolvedValue(undefined),
    ...props,
  };
  render(<SigningApprovalScreen {...all} />);
  return all;
}

/** Matches the innermost element whose text is exactly `text`; Testing Library would fold its narrow no-break spaces. */
function exact(text: string) {
  return (_content: string, element: Element | null): boolean =>
    element !== null && element.textContent === text && !Array.from(element.children).some((child) => child.textContent === text);
}

function exactGroup(atomic: string) {
  return exact(groupDigits(atomic));
}

function primary(name: RegExp | string) {
  return screen.getByRole("button", { name });
}

function openDetails() {
  fireEvent.click(screen.getByRole("button", { name: /^Details/ }));
}

describe("SigningApprovalScreen transfer layout: AO token", () => {
  it("shows the header, amount, fiat, From and the full To, token, fee and balance after", () => {
    renderScreen({ preview: AO_PREVIEW });

    expect(screen.getByText("https://")).toBeTruthy();
    expect(screen.getByText("dapp.example")).toBeTruthy();
    expect(screen.getByText("Transfer request")).toBeTruthy();
    expect(screen.getByText("1.5")).toBeTruthy();
    expect(screen.getAllByText("AO").length).toBeGreaterThan(0);
    expect(screen.getByText(`≈ ${formatCurrencyValue(1.5 * 8.4, "USD")}`)).toBeTruthy();
    expect(screen.getByText("Main")).toBeTruthy();
    expect(screen.getByText("Gx7c…k2Qa")).toBeTruthy();
    expect(screen.getByText(addressText(RECIPIENT))).toBeTruthy();
    expect(screen.getByText(truncateAddress(AO, 6))).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    expect(balanceAfterText()).toBe("10.75 AO");
  });

  it("shows the site's icon when its grant has one, and the letter tile otherwise", () => {
    renderScreen({ preview: AO_PREVIEW, siteIcon: "https://dapp.example/icon.png" });
    expect(document.querySelector('img[src="https://dapp.example/icon.png"]')).not.toBeNull();
    expect(screen.queryByText("D")).toBeNull();
    cleanup();
    renderScreen({ preview: AO_PREVIEW });
    expect(screen.getByText("D")).toBeTruthy();
  });

  it("puts the raw atomic amount, digit-grouped, in the collapsed Details button", () => {
    renderScreen({ preview: AO_PREVIEW });
    const details = screen.getByRole("button", { name: /^Details/ });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    expect(within(details).getByText(exactGroup("1500000000000")).getAttribute("dir")).toBe("ltr");
    expect(groupDigits("1500000000000")).toBe("1 500 000 000 000");
  });

  it("expands Details to the full process id, the method and every tag", () => {
    renderScreen({ preview: AO_PREVIEW });
    expect(screen.queryByText(AO)).toBeNull();
    openDetails();
    expect(screen.getByRole("button", { name: /^Details/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(AO)).toBeTruthy();
    expect(screen.getByText("Raw units")).toBeTruthy();
    expect(screen.getAllByText(exactGroup("1500000000000"))).toHaveLength(2);
    expect(screen.getByText("transferAoTokens")).toBeTruthy();
    expect(screen.queryByText("Transfer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View all 2 tags" }));
    expect(screen.getByText("Transfer")).toBeTruthy();
    expect(screen.getByText(AO_PREVIEW.payloadHash)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy signing payload/i })).toBeTruthy();
  });

  it("hides the fiat line and the balance after when they aren't known", () => {
    renderScreen({ preview: AO_PREVIEW, context: {} });
    expect(screen.queryByText(/≈/)).toBeNull();
    expect(screen.queryByText("Balance after")).toBeNull();
  });

  it("masks the balance after while balances are hidden", () => {
    renderScreen({ preview: AO_PREVIEW, context: { ...CONTEXT, balancesHidden: true } });
    expect(screen.getByText(HIDDEN_AMOUNT)).toBeTruthy();
  });

  it("names a token by its shortened id when its ticker only echoes the id back", () => {
    renderScreen({ preview: { ...AO_PREVIEW, token: WAR, tokenTicker: WAR }, context: {} });
    expect(screen.getAllByText("WWWWWW…WWWW").length).toBeGreaterThan(0);
  });
});

describe("SigningApprovalScreen transfer layout: AR", () => {
  it("says AR for the token, the fee in AR, and takes amount and fee off the balance", () => {
    renderScreen({ preview: AR_PREVIEW });
    expect(screen.getByText("50")).toBeTruthy();
    expect(screen.getAllByText("AR").length).toBeGreaterThan(1);
    expect(screen.getByText("0.0008 AR")).toBeTruthy();
    expect(balanceAfterText()).toBe("49.9992 AR");
    expect(screen.getByText(`≈ ${formatCurrencyValue(50 * 8.7, "USD")}`)).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /^Details/ })).getByText(exactGroup("50000000000000"))).toBeTruthy();
  });

  it("shows a tiny amount exactly and a tiny fee rounded up, never to 0", () => {
    renderScreen({ preview: { ...AR_PREVIEW, amount: "10000000", fee: "46409930" } });
    expect(screen.getByText("0.00001")).toBeTruthy();
    expect(screen.getByText("0.0000465 AR")).toBeTruthy();
  });

  it("leaves out a fiat line priced in the token being sent", () => {
    renderScreen({ preview: AR_PREVIEW, context: { ...CONTEXT, currency: "AR" } });
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  it("names the method in Details", () => {
    renderScreen({ preview: AR_PREVIEW });
    openDetails();
    expect(screen.getByText("dispatch")).toBeTruthy();
    expect(screen.getByText(AR_PREVIEW.payloadHash)).toBeTruthy();
  });
});

describe("SigningApprovalScreen primary action and warning", () => {
  it("is black, with no warning box, for a recipient sent to before", () => {
    renderScreen({ preview: AO_PREVIEW });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(primary("Sign").className).toContain("bg-foreground");
    expect(primary("Sign").className).not.toContain("bg-warning");
  });

  it("notes a first-time recipient without the red box or a red Sign", () => {
    renderScreen({ preview: AO_PREVIEW, assessment: { firstTime: true, lookalikeOf: null } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("note").textContent).toMatch(/haven't sent to this address before/);
    expect(primary("Sign").className).not.toContain("bg-warning");
  });

  it("still warns, in red, when the recipient lookup failed", () => {
    renderScreen({ preview: AO_PREVIEW, assessment: null });
    expect(screen.getByRole("alert").textContent).toMatch(/cannot be undone/i);
    expect(primary("Sign").className).toContain("bg-warning");
  });

  it("names the address a lookalike recipient imitates, in one red notice", () => {
    const known = "xU9zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAk3kL";
    renderScreen({ preview: AO_PREVIEW, assessment: { firstTime: true, lookalikeOf: known } });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toMatch(/This may be a phishing attempt/);
    expect(screen.getByText(addressText(known))).toBeTruthy();
    expect(primary("Sign").hasAttribute("disabled")).toBe(false);
  });

  it("calls onSign on click, and shows a failure inline", async () => {
    const onSign = vi.fn().mockRejectedValue(new Error("Signing kind not implemented yet"));
    renderScreen({ preview: AO_PREVIEW, onSign });
    fireEvent.click(primary("Sign"));
    expect(onSign).toHaveBeenCalledWith();
    await screen.findByText(/signing kind not implemented yet/i);
  });

  it("calls onReject from Reject", () => {
    const props = renderScreen({ preview: AO_PREVIEW });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(props.onReject).toHaveBeenCalledTimes(1);
  });
});

describe("SigningApprovalScreen transfer layout: unreadable token transfer", () => {
  const UNREADABLE: SigningApprovalPreview = {
    ...AR_PREVIEW,
    kind: "sign",
    amount: "7",
    tags: [
      { name: "action", value: "transfer" },
      { name: "recipient", value: SECOND_RECIPIENT },
      { name: "quantity", value: "5000000" },
    ],
    unreadableTokenTransfer: true,
  };

  it("warns, even for a known recipient, turns Sign red and shows the tags", () => {
    renderScreen({ preview: UNREADABLE });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/may be a token transfer Gleam can't read/);
    expect(alert.textContent).not.toMatch(/haven't sent to this address before/);
    expect(primary("Sign").className).toContain("bg-warning");
    expect(screen.getByRole("button", { name: "Hide tags" })).toBeTruthy();
    expect(screen.getByText(SECOND_RECIPIENT)).toBeTruthy();
  });
});

describe("SigningApprovalScreen transfer layout: unknown scale", () => {
  const UNKNOWN: SigningApprovalPreview = { ...AO_PREVIEW, token: WAR, tokenDenomination: null, tokenTicker: "wAR" };

  it("shows the amount in raw units, a ? glyph and the full token id", () => {
    renderScreen({ preview: UNKNOWN });
    expect(screen.getAllByText(exactGroup("1500000000000")).length).toBe(2);
    expect(screen.getByText("raw units")).toBeTruthy();
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.getByText(WAR)).toBeTruthy();
    expect(screen.queryByText("wAR")).toBeNull();
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  it("warns that the token states no decimals, even for a known recipient, and turns Sign red", () => {
    renderScreen({ preview: UNKNOWN });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/doesn't say how many decimals it uses/);
    expect(alert.textContent).not.toMatch(/haven't sent to this address before/);
    expect(primary("Sign").className).toContain("bg-warning");
  });

  it("shows the balance after unscaled", () => {
    renderScreen({ preview: UNKNOWN, context: { balances: { arBalance: "0", tokenBalances: [balance(WAR, "wAR", "5000000000000")] } } });
    expect(screen.getByText(exactGroup("3500000000000"))).toBeTruthy();
  });
});

describe("SigningApprovalScreen transfer layout: collectible and Gleam's own send", () => {
  const WALLET_SEND: SigningApprovalPreview = {
    ...AR_PREVIEW,
    kind: "transfer",
    amount: "0",
    fee: "654321",
    decodedData: "",
    collectible: { id: "N".repeat(43), name: "Beam #1", imageUrl: "https://arweave.net/asset" },
  };

  it("shows the thumbnail, name and 1 item instead of an amount, under Gleam's header", () => {
    renderScreen({ origin: WALLET_APPROVAL_ORIGIN, preview: WALLET_SEND });
    expect(screen.getByText("Gleam")).toBeTruthy();
    expect(screen.getByText("Send collectible")).toBeTruthy();
    expect(screen.getByText("Beam #1")).toBeTruthy();
    // The name already shows escaped beside it, so the image carries no alt text of its own.
    expect(document.querySelector('img[src="https://arweave.net/asset"]')!.getAttribute("alt")).toBe("");
    expect(screen.getByText("1 item")).toBeTruthy();
    expect(screen.getByText(addressText(RECIPIENT))).toBeTruthy();
    expect(screen.getByText("NNNNNN…NNNN")).toBeTruthy();
    expect(screen.getByText("0.000000655 AR")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /^Details/ })).getByText("1")).toBeTruthy();
  });

  it("offers Cancel and Send, and calls the method a wallet send with no payload hash", () => {
    renderScreen({ origin: WALLET_APPROVAL_ORIGIN, preview: { ...AR_PREVIEW, kind: "transfer" } });
    expect(screen.getByText("Gleam")).toBeTruthy();
    expect(screen.getAllByText("Send").length).toBe(2);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    openDetails();
    expect(screen.getByText("Wallet send")).toBeTruthy();
    expect(screen.queryByText(/Signing payload/)).toBeNull();
  });
});

describe("SigningApprovalScreen transfer layout: data items", () => {
  const ITEM_TRANSFER = {
    decodedData: null,
    tags: [{ name: "Action", value: "Transfer" }],
    target: AO,
    payloadHash: "2b8e5f0a3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c1a9d4f7c",
    transfer: { token: AO, recipient: RECIPIENT, amount: "1500000000000", tokenDenomination: 12, tokenTicker: "AO" },
  };

  it("reads a single signDataItem that carries a transfer as that transfer", () => {
    renderScreen({ preview: { ...MESSAGE_PREVIEW, items: [ITEM_TRANSFER] } });
    expect(screen.getByText("Transfer request")).toBeTruthy();
    expect(screen.getByText("1.5")).toBeTruthy();
    expect(screen.getByText(addressText(RECIPIENT))).toBeTruthy();
    expect(screen.getByText(truncateAddress(AO, 6))).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    openDetails();
    expect(screen.getByText("signDataItem")).toBeTruthy();
    expect(screen.getByText(ITEM_TRANSFER.payloadHash)).toBeTruthy();
    expect(primary("Sign")).toBeTruthy();
  });

  it("shows a batch as one card per transfer, the total value, and plain cards for the rest", () => {
    const preview: SigningApprovalPreview = {
      ...MESSAGE_PREVIEW,
      kind: "batchSignDataItem",
      items: [
        ITEM_TRANSFER,
        {
          ...ITEM_TRANSFER,
          target: WAR,
          transfer: { token: WAR, recipient: SECOND_RECIPIENT, amount: "250000000000", tokenDenomination: 12, tokenTicker: "wAR" },
        },
        { decodedData: '{"Action":"Notify"}', tags: [{ name: "Action", value: "Notify" }], target: null, payloadHash: "f".repeat(64), transfer: null },
      ],
    };
    renderScreen({ preview });
    expect(screen.getByText("2 transfers")).toBeTruthy();
    expect(screen.getByText(`≈ ${formatCurrencyValue(1.5 * 8.4 + 0.25 * 8.72, "USD")}`)).toBeTruthy();
    expect(screen.getByText("Total value")).toBeTruthy();
    expect(screen.getByText(addressText(RECIPIENT))).toBeTruthy();
    expect(screen.getByText(addressText(SECOND_RECIPIENT))).toBeTruthy();
    expect(screen.getByText("0.25")).toBeTruthy();
    expect(screen.getByText(/"Action":"Notify"/)).toBeTruthy();
    expect(screen.getByText("Main")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    expect(balanceAfterText()).toBe("10.75 AO · 1.2 wAR");
    expect(within(screen.getByRole("button", { name: /^Details/ })).getByText("batchSignDataItem · 3 items")).toBeTruthy();
    expect(primary("Sign 3")).toBeTruthy();
  });

  it("names each batch transfer's process and raw units without opening Details", () => {
    const OTHER = "O".repeat(43);
    const preview: SigningApprovalPreview = {
      ...MESSAGE_PREVIEW,
      kind: "batchSignDataItem",
      items: [
        ITEM_TRANSFER,
        { ...ITEM_TRANSFER, target: OTHER, transfer: { ...ITEM_TRANSFER.transfer, token: OTHER, amount: "7000000" } },
      ],
    };
    renderScreen({ preview });
    expect(screen.getByRole("button", { name: /^Details/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(truncateAddress(AO, 6))).toBeTruthy();
    expect(screen.getByText(truncateAddress(OTHER, 6))).toBeTruthy();
    expect(screen.getByText(exactGroup("1500000000000"))).toBeTruthy();
    expect(screen.getByText(exactGroup("7000000"))).toBeTruthy();
  });

  it("names the process of a transfer mixed with a plain item without opening Details", () => {
    const preview: SigningApprovalPreview = {
      ...MESSAGE_PREVIEW,
      kind: "batchSignDataItem",
      items: [
        ITEM_TRANSFER,
        { decodedData: null, tags: [{ name: "Action", value: "Notify" }], target: null, payloadHash: "f".repeat(64), transfer: null },
      ],
    };
    renderScreen({ preview });
    expect(screen.getByText(truncateAddress(AO, 6))).toBeTruthy();
    expect(screen.getByText(exactGroup("1500000000000"))).toBeTruthy();
  });

  it("leaves out the total value unless every transfer is priced", () => {
    const preview: SigningApprovalPreview = {
      ...MESSAGE_PREVIEW,
      kind: "batchSignDataItem",
      items: [
        ITEM_TRANSFER,
        { ...ITEM_TRANSFER, transfer: { ...ITEM_TRANSFER.transfer, token: "U".repeat(43), tokenTicker: "UNP" } },
      ],
    };
    renderScreen({ preview });
    expect(screen.queryByText("Total value")).toBeNull();
    expect(screen.getByText(`≈ ${formatCurrencyValue(1.5 * 8.4, "USD")}`)).toBeTruthy();
  });
});

describe("SigningApprovalScreen: requests that move nothing", () => {
  it("shows decoded data, tags and the payload hash under the same header, without a warning", () => {
    renderScreen({ preview: MESSAGE_PREVIEW });
    expect(screen.getByText("dapp.example")).toBeTruthy();
    expect(screen.getAllByText("Sign message").length).toBe(2);
    expect(screen.getByText(/"Action":"Eval"/)).toBeTruthy();
    expect(screen.getByText("Eval")).toBeTruthy();
    expect(screen.getByText(MESSAGE_PREVIEW.payloadHash)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign message" }).className).not.toContain("bg-warning");
    expect(screen.queryByText("Network fee")).toBeNull();
  });

  it("lists every item of a batch with no transfer in it", () => {
    const preview: SigningApprovalPreview = {
      ...MESSAGE_PREVIEW,
      kind: "batchSignDataItem",
      items: [
        { decodedData: '{"Action":"Eval"}', tags: [], target: null, payloadHash: "a".repeat(64), transfer: null },
        { decodedData: '{"Action":"Notify"}', tags: [{ name: "Action", value: "Notify" }], target: RECIPIENT, payloadHash: "b".repeat(64), transfer: null },
      ],
    };
    renderScreen({ preview });
    expect(screen.getByText(/2 items to sign/i)).toBeTruthy();
    expect(screen.getByText(/"Action":"Notify"/)).toBeTruthy();
    expect(screen.getByText(addressText(RECIPIENT))).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign messages \(2\)/i })).toBeTruthy();
  });

  const UNREADABLE_ITEM = {
    decodedData: null,
    tags: [
      { name: "action", value: "transfer" },
      { name: "recipient", value: SECOND_RECIPIENT },
      { name: "quantity", value: "5000000" },
    ],
    target: AO,
    payloadHash: "c".repeat(64),
    transfer: null,
    unreadableTokenTransfer: true,
  };

  function expectOnlyItemMarkedUnreadable(number: number) {
    const [marker, ...rest] = screen.getAllByText("Unreadable transfer");
    expect(rest).toHaveLength(0);
    expect(marker!.parentElement!.textContent).toContain(`Item ${number}`);
  }

  it("warns about a single data item that may be a token transfer it can't read, turns Sign red and shows its tags", () => {
    renderScreen({ preview: { ...MESSAGE_PREVIEW, items: [UNREADABLE_ITEM] } });
    expect(screen.getByRole("alert").textContent).toMatch(/may be a token transfer Gleam can't read/);
    expect(screen.getByRole("button", { name: "Sign message" }).className).toContain("bg-warning");
    expect(screen.getByText(SECOND_RECIPIENT)).toBeTruthy();
    expect(screen.getByText("5000000")).toBeTruthy();
  });

  it("warns about a batch with no transfer when any item may be one it can't read", () => {
    const preview: SigningApprovalPreview = {
      ...MESSAGE_PREVIEW,
      kind: "batchSignDataItem",
      items: [{ decodedData: null, tags: [], target: null, payloadHash: "a".repeat(64), transfer: null }, UNREADABLE_ITEM],
    };
    renderScreen({ preview });
    expect(screen.getByRole("alert").textContent).toMatch(/may be a token transfer Gleam can't read/);
    expect(screen.getByRole("button", { name: /sign messages \(2\)/i }).className).toContain("bg-warning");
    expect(screen.getByText(SECOND_RECIPIENT)).toBeTruthy();
    expectOnlyItemMarkedUnreadable(2);
  });

  it("warns about a batch with transfers when another item may be one it can't read", () => {
    const transferItem = {
      decodedData: null,
      tags: [{ name: "Action", value: "Transfer" }],
      target: AO,
      payloadHash: "d".repeat(64),
      transfer: { token: AO, recipient: RECIPIENT, amount: "1500000000000", tokenDenomination: 12, tokenTicker: "AO" },
    };
    renderScreen({ preview: { ...MESSAGE_PREVIEW, kind: "batchSignDataItem", items: [transferItem, UNREADABLE_ITEM] } });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/may be a token transfer Gleam can't read/);
    expect(primary("Sign 2").className).toContain("bg-warning");
    expect(screen.getByText(SECOND_RECIPIENT)).toBeTruthy();
    expectOnlyItemMarkedUnreadable(2);
  });

  it.each(["sign", "dispatch"] as const)("shows the fee of a %s with no recipient", (kind) => {
    renderScreen({ preview: { ...AR_PREVIEW, kind, recipient: null, amount: null, fee: "900000000000000" } });
    expect(screen.getByText("Network fee")).toBeTruthy();
    expect(screen.getByText("900 AR")).toBeTruthy();
  });
});
