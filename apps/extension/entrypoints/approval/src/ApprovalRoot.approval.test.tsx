import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApprovalRequest, RuntimePort, ThemeSettings, WalletState } from "@gleam/core";
import { ApprovalRoot } from "./ApprovalRoot";

afterEach(() => {
  cleanup();
});

const CONNECT_REQUEST: ApprovalRequest = {
  requestId: "req-1",
  origin: "https://bazar.arweave.net",
  kind: "connect",
  preview: { kind: "connect", requestedPermissions: ["ACCESS_ADDRESS"], appInfo: null },
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
  backupConfirmedAt: null,
};

const UNLOCKED_STATE: WalletState = {
  wallets: [WALLET_SUMMARY],
  activeWalletId: "wallet-1",
  session: { unlockedAt: 0, lastActivityAt: 0, autoLockTimeout: "never", unlockedWalletIds: ["wallet-1"] },
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
 * `ApprovalRoot.tsx`'s own doc comment) — so this must independently
 * prove the stored theme preference is actually applied here, not just
 * assume App.tsx's wiring covers it.
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
    tokenDenomination: null,
    tokenTicker: null,
    decodedData: "hello",
    tags: [],
    payloadHash: "ab".repeat(32),
    items: null,
  },
  createdAt: 0,
};

const ADD_TOKEN_REQUEST: ApprovalRequest = {
  requestId: "req-3",
  origin: "https://bazar.arweave.net",
  kind: "addToken",
  preview: { kind: "addToken", processId: "p".repeat(43), ticker: "TKN", name: "Token", address: "addr-1" },
  createdAt: 0,
};

function runtimeResolvingWith(request: ApprovalRequest, resolveApproval: () => Promise<void>): RuntimePort {
  const send = vi.fn(async (message: { type: string }) => {
    if (message.type === "getState") return UNLOCKED_STATE;
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
  it("shows an addToken request on its own screen and approves it", async () => {
    const resolve = vi.fn(async () => undefined);
    const runtime = runtimeResolvingWith(ADD_TOKEN_REQUEST, resolve);
    render(<ApprovalRoot requestId="req-3" runtime={runtime} />);

    expect(await screen.findByText("TKN")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add token" }));

    expect(await screen.findByText("Token added.")).toBeTruthy();
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

/**
 * Stands in for the background: `getState` reads `walletState`, which
 * `unlockWallet` and `createWallet` change as the real handlers would.
 */
function statefulRuntime(initial: WalletState, request: ApprovalRequest) {
  let walletState = initial;
  const send = vi.fn(async (message: { type: string; payload?: unknown }) => {
    switch (message.type) {
      case "getState":
        return walletState;
      case "getApproval":
        return request;
      case "getThemePreference":
        return { theme: "light" } satisfies ThemeSettings;
      case "unlockWallet":
        if ((message.payload as { password: string }).password !== "correct horse battery staple") {
          throw new Error("That password didn't work.");
        }
        walletState = UNLOCKED_STATE;
        return { unlockedWalletIds: ["wallet-1"] };
      case "createWallet":
        walletState = UNLOCKED_STATE;
        return WALLET_SUMMARY;
      case "exportWallet":
        return { kty: "RSA", n: "n" };
      case "resolveApproval":
        return undefined;
      default:
        throw new Error(`unexpected message ${message.type}`);
    }
  });
  return { runtime: fakeRuntime({ send: send as never }), send };
}

describe("ApprovalRoot: locked wallet", () => {
  const LOCKED_STATE: WalletState = { ...UNLOCKED_STATE, session: null };

  it("asks for the password before showing the request, then continues it", async () => {
    const { runtime, send } = statefulRuntime(LOCKED_STATE, SIGN_MESSAGE_REQUEST);
    render(<ApprovalRoot requestId="req-2" runtime={runtime} />);

    expect(await screen.findByText("Unlock to review bazar.arweave.net's request")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign message" })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Enter your password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    fireEvent.click(await screen.findByRole("button", { name: "Sign message" }));
    expect(await screen.findByText("Signed.")).toBeTruthy();
    expect(send).toHaveBeenCalledWith({
      type: "resolveApproval",
      payload: { requestId: "req-2", approved: true },
    });
  });

  it("stays on unlock with the error when the password is wrong", async () => {
    const { runtime } = statefulRuntime(LOCKED_STATE, CONNECT_REQUEST);
    render(<ApprovalRoot requestId="req-1" runtime={runtime} />);

    fireEvent.change(await screen.findByPlaceholderText("Enter your password"), {
      target: { value: "wrong password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText(/didn't work/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Grant" })).toBeNull();
  });

  it("asks for unlock when only a wallet other than the active one is unlocked", async () => {
    const otherUnlocked: WalletState = {
      ...UNLOCKED_STATE,
      session: { ...UNLOCKED_STATE.session!, unlockedWalletIds: ["wallet-2"] },
    };
    const { runtime } = statefulRuntime(otherUnlocked, CONNECT_REQUEST);
    render(<ApprovalRoot requestId="req-1" runtime={runtime} />);

    expect(await screen.findByPlaceholderText("Enter your password")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Grant" })).toBeNull();
  });
});

describe("ApprovalRoot: no wallet yet", () => {
  const EMPTY_STATE: WalletState = { wallets: [], activeWalletId: null, session: null };

  it("runs onboarding in place, then shows the pending request", async () => {
    const { runtime } = statefulRuntime(EMPTY_STATE, CONNECT_REQUEST);
    render(<ApprovalRoot requestId="req-1" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Create a wallet" }));
    fireEvent.change(screen.getByPlaceholderText("At least 10 characters"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue to wallet" }));

    fireEvent.click(await screen.findByRole("button", { name: "Grant" }));
    expect(await screen.findByText("Grant approved.")).toBeTruthy();
  });

  it("shows why instead of onboarding when the request is already gone", async () => {
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === "getApproval") throw new Error('No pending approval request with id "req-1".');
      if (message.type === "getState") return EMPTY_STATE;
      if (message.type === "getThemePreference") return { theme: "light" } satisfies ThemeSettings;
      throw new Error(`unexpected message ${message.type}`);
    });
    render(<ApprovalRoot requestId="req-1" runtime={fakeRuntime({ send: send as never })} />);

    expect(await screen.findByText(/no pending approval request/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create a wallet" })).toBeNull();
  });
});
