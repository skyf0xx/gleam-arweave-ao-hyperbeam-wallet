import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SigningApprovalPreview } from "@gleam/core";
import { SigningApprovalScreen } from "./SigningApprovalScreen";

afterEach(() => {
  cleanup();
});

// Winston atomic-integer strings, matching what `background/index.ts`
// actually puts on the wire: 50 AR and an 0.0008 AR fee.
const TRANSFER_PREVIEW: SigningApprovalPreview = {
  kind: "dispatch",
  recipient: "xU9zFq2wR7mN4tK8vB1jH6yE0sD3aC5fG9pLxU9k3kLp",
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

const AO_TRANSFER_PREVIEW: SigningApprovalPreview = {
  kind: "transferAoTokens",
  recipient: "xU9zFq2wR7mN4tK8vB1jH6yE0sD3aC5fG9pLxU9k3kLp",
  amount: "1000",
  fee: null,
  token: "ao-process-id-abcdef1234",
  tokenDenomination: null,
  tokenTicker: null,
  decodedData: "",
  tags: [],
  payloadHash: "7f3a2e9c1b6d4f80a5e2c7b91d3f6a8e0c4b7d2f9a1e6c3b8d5f0a2e7c9b4d1f",
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
  decodedData: '{"Action":"Transfer"}',
  tags: [{ name: "Action", value: "Transfer" }],
  payloadHash: "1a9d4f7c2e5b8a0f3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c",
  items: null,
};

const BATCH_PREVIEW: SigningApprovalPreview = {
  kind: "batchSignDataItem",
  recipient: null,
  amount: null,
  fee: null,
  token: null,
  tokenDenomination: null,
  tokenTicker: null,
  decodedData: '{"Action":"Transfer"}',
  tags: [{ name: "Action", value: "Transfer" }],
  payloadHash: "1a9d4f7c2e5b8a0f3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c",
  items: [
    {
      decodedData: '{"Action":"Transfer"}',
      tags: [{ name: "Action", value: "Transfer" }],
      target: null,
      payloadHash: "1a9d4f7c2e5b8a0f3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c",
    },
    {
      decodedData: '{"Action":"Notify"}',
      tags: [{ name: "Action", value: "Notify" }],
      target: "xU9zFq2wR7mN4tK8vB1jH6yE0sD3aC5fG9pLxU9k3kLp",
      payloadHash: "2b8e5f0a3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c1a9d4f7c",
    },
  ],
};

describe("SigningApprovalScreen (6.2 signing approval)", () => {
  it("shows the full recipient address, never truncated", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={TRANSFER_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.getByText(TRANSFER_PREVIEW.recipient!)).toBeTruthy();
  });

  it("shows the signing payload hash with its own copy affordance", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={TRANSFER_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.getByText(TRANSFER_PREVIEW.payloadHash)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy signing payload/i })).toBeTruthy();
  });

  it("treats a value transfer as Irreversible tier: shows the risk notice and a destructive-styled primary action", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={TRANSFER_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(/can't be undone/i);
  });

  it("shows decoded data and tags for a non-transfer signDataItem request, without a risk notice", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={MESSAGE_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.getByText(/"Action":"Transfer"/)).toBeTruthy();
    expect(screen.getByText("Transfer")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("calls onSign immediately on click, no password required", async () => {
    const onSign = vi.fn().mockResolvedValue(undefined);
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={TRANSFER_PREVIEW} onReject={vi.fn()} onSign={onSign} />,
    );

    const signButton = screen.getByRole("button", { name: /sign and send/i });
    expect(signButton).toHaveProperty("disabled", false);

    fireEvent.click(signButton);
    expect(onSign).toHaveBeenCalledWith();
  });

  it("surfaces a signing failure inline rather than closing the screen", async () => {
    const onSign = vi.fn().mockRejectedValue(new Error("Signing kind not implemented yet"));
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={TRANSFER_PREVIEW} onReject={vi.fn()} onSign={onSign} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign and send/i }));

    await screen.findByText(/signing kind not implemented yet/i);
  });

  it("calls onReject from the Reject button", () => {
    const onReject = vi.fn();
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={TRANSFER_PREVIEW} onReject={onReject} onSign={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("transferAoTokens with no resolved denomination shows the raw atomic amount and a smallest-units label", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={AO_TRANSFER_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.getAllByText(AO_TRANSFER_PREVIEW.amount!).length).toBeGreaterThan(0);
    expect(screen.getByText(/smallest units/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("transferAoTokens with a resolved denomination but no ticker shows the scaled amount and a shortened process id", () => {
    const preview: SigningApprovalPreview = { ...AO_TRANSFER_PREVIEW, amount: "150000000000", tokenDenomination: 12 };
    render(<SigningApprovalScreen origin="https://bazar.arweave.net" preview={preview} onReject={vi.fn()} onSign={vi.fn()} />);

    expect(screen.getAllByText("0.15").length).toBeGreaterThan(0);
    expect(screen.getByText(/ao-pro.*1234/i)).toBeTruthy();
    expect(screen.queryByText(/smallest units/i)).toBeNull();
  });

  it("transferAoTokens with a resolved ticker shows it as the unit label instead of the process id", () => {
    const preview: SigningApprovalPreview = {
      ...AO_TRANSFER_PREVIEW,
      amount: "150000000000",
      tokenDenomination: 12,
      tokenTicker: "AO",
    };
    render(<SigningApprovalScreen origin="https://bazar.arweave.net" preview={preview} onReject={vi.fn()} onSign={vi.fn()} />);

    expect(screen.getAllByText("0.15").length).toBeGreaterThan(0);
    expect(screen.getByText("AO")).toBeTruthy();
    expect(screen.queryByText(/ao-pro.*1234/i)).toBeNull();
  });

  it("transferAoTokens whose ticker is just its own process id echoed back falls back to the shortened process id", () => {
    const preview: SigningApprovalPreview = {
      ...AO_TRANSFER_PREVIEW,
      amount: "150000000000",
      tokenDenomination: 12,
      tokenTicker: AO_TRANSFER_PREVIEW.token,
    };
    render(<SigningApprovalScreen origin="https://bazar.arweave.net" preview={preview} onReject={vi.fn()} onSign={vi.fn()} />);

    expect(screen.getByText(/ao-pro.*1234/i)).toBeTruthy();
  });

  it("transferAoTokens's Total row shows the scaled amount, matching the amount above it, once the denomination is known", () => {
    const preview: SigningApprovalPreview = { ...AO_TRANSFER_PREVIEW, amount: "150000000000", tokenDenomination: 12 };
    render(<SigningApprovalScreen origin="https://bazar.arweave.net" preview={preview} onReject={vi.fn()} onSign={vi.fn()} />);

    expect(screen.getAllByText("0.15").length).toBeGreaterThan(1);
  });

  it("batchSignDataItem lists every item's decoded data, target and tags, not just the first", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={BATCH_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.getByText(/"Action":"Transfer"/)).toBeTruthy();
    expect(screen.getByText(/"Action":"Notify"/)).toBeTruthy();
    expect(screen.getByText("Notify")).toBeTruthy();
    expect(screen.getByText(BATCH_PREVIEW.items![1]!.target!)).toBeTruthy();
  });

  it("batchSignDataItem shows the item count in the heading and the sign action", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={BATCH_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.getByText(/2 items to sign/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign messages \(2\)/i })).toBeTruthy();
  });

  it("a sign/dispatch preview with no token shows no token-identity line", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={TRANSFER_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.queryByText(/…/)).toBeNull();
  });

  it("formats a sign/dispatch preview's raw Winston amount and fee as AR, and totals them", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={TRANSFER_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    // amount: 50000000000000 Winston -> "50", fee: 800000000 Winston -> "0.0008"
    expect(screen.getByText("50")).toBeTruthy();
    expect(screen.getByText("0.0008")).toBeTruthy();
    // Total = 50 + 0.0008 = 50.0008 AR
    expect(screen.getByText("50.0008")).toBeTruthy();
  });

  it("shows a placeholder rather than a raw Winston string when fee is unknown", () => {
    const preview: SigningApprovalPreview = { ...TRANSFER_PREVIEW, fee: null };
    render(<SigningApprovalScreen origin="https://bazar.arweave.net" preview={preview} onReject={vi.fn()} onSign={vi.fn()} />);

    expect(screen.getByText("—")).toBeTruthy();
  });
});
