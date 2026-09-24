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
  appInfo: null,
};

const UNLIMITED_PREVIEW: ConnectApprovalPreview = {
  kind: "connect",
  requestedPermissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"],
  appInfo: null,
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

  it("falls back to an origin-derived name when the dApp supplied no appInfo", () => {
    render(
      <ConnectionRequestScreen
        origin="https://bazar.arweave.net"
        preview={SCOPED_PREVIEW}
        onReject={vi.fn()}
        onGrant={vi.fn()}
      />,
    );

    expect(screen.getByText("Bazar")).toBeTruthy();
  });

  it("shows the dApp-supplied appInfo name instead of the origin-derived fallback", () => {
    const preview: ConnectApprovalPreview = {
      ...SCOPED_PREVIEW,
      appInfo: { name: "Permaswap", logo: null },
    };
    render(
      <ConnectionRequestScreen origin="https://bazar.arweave.net" preview={preview} onReject={vi.fn()} onGrant={vi.fn()} />,
    );

    expect(screen.getByText("Permaswap")).toBeTruthy();
    expect(screen.queryByText("Bazar")).toBeNull();
  });

  it("renders the dApp-supplied logo when present", () => {
    const preview: ConnectApprovalPreview = {
      ...SCOPED_PREVIEW,
      appInfo: { name: "Permaswap", logo: "https://permaswap.example/logo.png" },
    };
    const { container } = render(
      <ConnectionRequestScreen origin="https://bazar.arweave.net" preview={preview} onReject={vi.fn()} onGrant={vi.fn()} />,
    );

    const img = container.querySelector("img") as HTMLImageElement | null;
    expect(img?.src).toBe("https://permaswap.example/logo.png");
  });

  it("falls back to the origin-derived letter tile when the logo fails to load", () => {
    const preview: ConnectApprovalPreview = {
      ...SCOPED_PREVIEW,
      appInfo: { name: "Permaswap", logo: "https://permaswap.example/logo.png" },
    };
    const { container } = render(
      <ConnectionRequestScreen origin="https://bazar.arweave.net" preview={preview} onReject={vi.fn()} onGrant={vi.fn()} />,
    );

    const img = container.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("B")).toBeTruthy();
  });
});
