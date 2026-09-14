import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ConnectApprovalPreview } from "@gleam/core";
import { ConnectionRequestScreen } from "./ConnectionRequestScreen";

afterEach(() => {
  cleanup();
});

const SCOPED_PREVIEW: ConnectApprovalPreview = {
  kind: "connect",
  requestedPermissions: ["ACCESS_ADDRESS", "ACCESS_TOKENS"],
};

const UNLIMITED_PREVIEW: ConnectApprovalPreview = {
  kind: "connect",
  requestedPermissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"],
};

describe("ConnectionRequestScreen (6.1 connection request)", () => {
  it("shows the origin and each requested scope in plain nouns", () => {
    render(
      <ConnectionRequestScreen
        origin="https://bazar.arweave.net"
        preview={SCOPED_PREVIEW}
        onReject={vi.fn()}
        onGrant={vi.fn()}
      />,
    );

    expect(screen.getByText("bazar.arweave.net")).toBeTruthy();
    expect(screen.getByText("See your address")).toBeTruthy();
    expect(screen.getByText("See your token balances")).toBeTruthy();
  });

  it("never uses the word 'connection' or 'approval' for the scope itself (brand vocabulary rule)", () => {
    render(
      <ConnectionRequestScreen
        origin="https://bazar.arweave.net"
        preview={SCOPED_PREVIEW}
        onReject={vi.fn()}
        onGrant={vi.fn()}
      />,
    );

    expect(screen.queryByText(/\bconnection\b/i)).toBeNull();
    expect(screen.queryByText(/\bapproval\b/i)).toBeNull();
  });

  it("stays at Consequential tier (no risk notice) for a scoped grant with no spending permission", () => {
    render(
      <ConnectionRequestScreen
        origin="https://bazar.arweave.net"
        preview={SCOPED_PREVIEW}
        onReject={vi.fn()}
        onGrant={vi.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("escalates to Irreversible-tier framing when the request includes SIGN_TRANSACTION", () => {
    render(
      <ConnectionRequestScreen
        origin="https://unknown-app.example"
        preview={UNLIMITED_PREVIEW}
        onReject={vi.fn()}
        onGrant={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(/no spending limit/i);
  });

  it("calls onGrant/onReject from their respective buttons", () => {
    const onGrant = vi.fn();
    const onReject = vi.fn();
    render(
      <ConnectionRequestScreen
        origin="https://bazar.arweave.net"
        preview={SCOPED_PREVIEW}
        onReject={onReject}
        onGrant={onGrant}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onGrant).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});
