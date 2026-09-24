import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApprovalRequest, RuntimePort, ThemeSettings } from "@gleam/core";
import { ApprovalRoot } from "./ApprovalRoot";

afterEach(() => {
  cleanup();
});

const CONNECT_REQUEST: ApprovalRequest = {
  requestId: "req-1",
  origin: "https://bazar.arweave.net",
  kind: "connect",
  preview: { kind: "connect", requestedPermissions: ["ACCESS_ADDRESS"] },
  createdAt: 0,
};

const WALLET_SUMMARY = {
  id: "wallet-1",
  address: "addr-1",
  name: "Main",
  method: "jwk" as const,
  publicKey: "pub",
  createdAt: 0,
  updatedAt: 0,
};

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

/**
 * This window mounts `ApprovalRoot` directly, never `<App>` (see
 * `ApprovalRoot.tsx`'s own doc comment) — so it's the one place in this
 * task's scope that must independently prove the stored theme preference
 * is actually applied here, not just assume App.tsx's wiring covers it.
 */
describe("ApprovalRoot theme application (provider-bridge closing wallet-core's approval-window gap)", () => {
  it("applies data-theme='dark' on the root once getThemePreference resolves dark", async () => {
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === "getState") return { wallets: [WALLET_SUMMARY], activeWalletId: "wallet-1", session: null };
      if (message.type === "getApproval") return CONNECT_REQUEST;
      if (message.type === "getThemePreference") return { theme: "dark" } satisfies ThemeSettings;
      throw new Error(`unexpected message ${message.type}`);
    });

    const { container } = render(<ApprovalRoot requestId="req-1" runtime={fakeRuntime({ send: send as never })} />);

    await waitFor(() => {
      expect(container.querySelector('[data-theme="dark"]')).toBeTruthy();
    });
  });

  it("omits data-theme when the stored preference is light", async () => {
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === "getState") return { wallets: [WALLET_SUMMARY], activeWalletId: "wallet-1", session: null };
      if (message.type === "getApproval") return CONNECT_REQUEST;
      if (message.type === "getThemePreference") return { theme: "light" } satisfies ThemeSettings;
      throw new Error(`unexpected message ${message.type}`);
    });

    const { container } = render(<ApprovalRoot requestId="req-1" runtime={fakeRuntime({ send: send as never })} />);

    await waitFor(() => {
      expect(container.querySelector("[data-theme]")).toBeNull();
    });
  });

  it("falls back to light rather than throwing when getThemePreference rejects", async () => {
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === "getState") return { wallets: [WALLET_SUMMARY], activeWalletId: "wallet-1", session: null };
      if (message.type === "getApproval") return CONNECT_REQUEST;
      if (message.type === "getThemePreference") throw new Error("not registered");
      throw new Error(`unexpected message ${message.type}`);
    });

    const { container } = render(<ApprovalRoot requestId="req-1" runtime={fakeRuntime({ send: send as never })} />);

    await waitFor(() => {
      expect(container.querySelector("[data-theme]")).toBeNull();
    });
  });
});

const SIGN_MESSAGE_REQUEST: ApprovalRequest = {
  requestId: "req-2",
  origin: "https://bazar.arweave.net",
  kind: "signMessage",
  preview: {
    kind: "signMessage",
    recipient: null,
    amount: null,
    fee: null,
    token: null,
    decodedData: "hello",
    tags: [],
    payloadHash: "ab".repeat(32),
    items: null,
  },
  createdAt: 0,
};

function runtimeResolvingWith(request: ApprovalRequest, resolveApproval: () => Promise<void>): RuntimePort {
  const send = vi.fn(async (message: { type: string }) => {
    if (message.type === "getState") return { wallets: [WALLET_SUMMARY], activeWalletId: "wallet-1", session: null };
    if (message.type === "getApproval") return request;
    if (message.type === "getThemePreference") return { theme: "light" } satisfies ThemeSettings;
    if (message.type === "resolveApproval") return resolveApproval();
    throw new Error(`unexpected message ${message.type}`);
  });
  return fakeRuntime({ send: send as never });
}

describe("ApprovalRoot outcome", () => {
  it("shows the signing error, not success, when resolveApproval fails", async () => {
    const runtime = runtimeResolvingWith(SIGN_MESSAGE_REQUEST, async () => {
      throw new Error('Wallet "wallet-1" is locked. Unlock it to continue.');
    });
    render(<ApprovalRoot requestId="req-2" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign message" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/signing failed/i);
    expect(alert.textContent).toMatch(/locked/i);
    expect(screen.queryByText("Signed.")).toBeNull();
    // Nothing left to retry: the request is gone once it fails.
    expect(screen.queryByRole("button", { name: "Sign message" })).toBeNull();
  });

  it("shows success once resolveApproval succeeds", async () => {
    const runtime = runtimeResolvingWith(SIGN_MESSAGE_REQUEST, async () => undefined);
    render(<ApprovalRoot requestId="req-2" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign message" }));

    expect(await screen.findByText("Signed.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the error when granting a connection fails", async () => {
    const runtime = runtimeResolvingWith(CONNECT_REQUEST, async () => {
      throw new Error("storage unavailable");
    });
    render(<ApprovalRoot requestId="req-1" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Grant" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't connect: storage unavailable/i);
    expect(screen.queryByText("Grant approved.")).toBeNull();
  });
});
