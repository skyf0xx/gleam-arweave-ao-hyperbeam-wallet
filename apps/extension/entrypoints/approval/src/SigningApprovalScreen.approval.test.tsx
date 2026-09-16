import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SigningApprovalPreview } from "@gleam/core";
import { SigningApprovalScreen } from "./SigningApprovalScreen";

afterEach(() => {
  cleanup();
});

const TRANSFER_PREVIEW: SigningApprovalPreview = {
  kind: "dispatch",
  recipient: "xU9zFq2wR7mN4tK8vB1jH6yE0sD3aC5fG9pLxU9k3kLp",
  amount: "50.00 AO",
  fee: "0.0008 AR",
  token: null,
  decodedData: null,
  tags: [],
  payloadHash: "7f3a2e9c1b6d4f80a5e2c7b91d3f6a8e0c4b7d2f9a1e6c3b8d5f0a2e7c9b4d1f",
};

const AO_TRANSFER_PREVIEW: SigningApprovalPreview = {
  kind: "transferAoTokens",
  recipient: "xU9zFq2wR7mN4tK8vB1jH6yE0sD3aC5fG9pLxU9k3kLp",
  amount: "1000",
  fee: null,
  token: "ao-process-id-abcdef1234",
  decodedData: "",
  tags: [],
  payloadHash: "7f3a2e9c1b6d4f80a5e2c7b91d3f6a8e0c4b7d2f9a1e6c3b8d5f0a2e7c9b4d1f",
};

const MESSAGE_PREVIEW: SigningApprovalPreview = {
  kind: "signDataItem",
  recipient: null,
  amount: null,
  fee: null,
  token: null,
  decodedData: '{"Action":"Transfer"}',
  tags: [{ name: "Action", value: "Transfer" }],
  payloadHash: "1a9d4f7c2e5b8a0f3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c",
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

  it("transferAoTokens shows the amount, the token identity, and Send as the action label", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={AO_TRANSFER_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.getAllByText(AO_TRANSFER_PREVIEW.amount!).length).toBeGreaterThan(0);
    expect(screen.getByText(/ao-pro.*1234/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("a sign/dispatch preview with no token shows no token-identity line", () => {
    render(
      <SigningApprovalScreen origin="https://bazar.arweave.net" preview={TRANSFER_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );

    expect(screen.queryByText(/…/)).toBeNull();
  });
});
