import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { WalletSummary } from "@gleam/core";
import { renderWithPlatform as render } from "../../../app-platform/testing";
import { ReceiveView } from "./ReceiveView";

afterEach(cleanup);

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "a".repeat(43),
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub1",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};

describe("ReceiveView", () => {
  it("calls a keyfile wallet's address yours, with no badge", () => {
    render(<ReceiveView wallet={WALLET} onBack={vi.fn()} />);

    expect(screen.getByText("Your address")).toBeTruthy();
    expect(screen.queryByText("Watch only")).toBeNull();
  });

  it("badges a watch wallet, whose address may not be the user's own", () => {
    render(<ReceiveView wallet={{ ...WALLET, method: "watch", publicKey: "" }} onBack={vi.fn()} />);

    expect(screen.getByText("Watch only")).toBeTruthy();
    expect(screen.getByText("Watched address")).toBeTruthy();
    expect(screen.queryByText("Your address")).toBeNull();
  });
});
