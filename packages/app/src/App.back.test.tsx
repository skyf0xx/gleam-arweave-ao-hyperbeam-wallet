import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { RuntimePort, WalletState, WalletSummary } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "./app-platform/testing";
import type { BackButtonPort } from "./app-platform/types";
import App from "./App";

afterEach(() => {
  cleanup();
});

const keyfileWallet: WalletSummary = {
  id: "w1",
  address: "addr",
  name: "Main",
  method: "jwk",
  publicKey: "pk",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};

const unlocked: WalletState = {
  wallets: [keyfileWallet],
  activeWalletId: "w1",
  session: { unlockedWalletIds: ["w1"], unlockedAt: 0, lastActivityAt: 0 },
} as unknown as WalletState;

function runtimeFor(state: WalletState): RuntimePort {
  return {
    send: vi.fn(async ({ type }: { type: string }) => {
      if (type === "getState") return state;
      if (type === "getThemePreference") return { theme: "light" };
      if (type === "getLockSettings") return { autoLockTimeout: "1hr" };
      if (type === "getPasskeyStatus") return { enrolled: false };
      if (type === "getBalance") return "0";
      if (type === "getTokenBalances") return [];
      if (type === "getContacts") return [];
      return null;
    }) as unknown as RuntimePort["send"],
    onMessage: () => () => {},
  };
}

/** Stands in for the shell: `press` is the Android back button. */
function fakeBackButton() {
  let handler: (() => boolean) | null = null;
  const port: BackButtonPort = {
    subscribe(next) {
      handler = next;
      return () => {
        handler = null;
      };
    },
  };
  return { port, press: () => handler?.() };
}

async function mount(back: ReturnType<typeof fakeBackButton>, passkey = true) {
  await act(async () => {
    render(
      <App layout="phone" />,
      fakeAppPlatform({ runtime: runtimeFor(unlocked), backButton: back.port, capabilities: { passkey } }),
    );
  });
}

const pressBack = async (back: ReturnType<typeof fakeBackButton>) => {
  let used: boolean | undefined;
  await act(async () => {
    used = back.press();
  });
  return used;
};

describe("system back button", () => {
  it("is left to the shell on the home screen", async () => {
    const back = fakeBackButton();
    await mount(back);
    expect(await screen.findByRole("button", { name: "Settings" })).toBeTruthy();
    expect(await pressBack(back)).toBe(false);
  });

  it("goes back one level at a time, then hands the press to the shell", async () => {
    const back = fakeBackButton();
    await mount(back);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Contacts"));
    });
    expect(await screen.findByText("No contacts yet.")).toBeTruthy();

    expect(await pressBack(back)).toBe(true);
    expect(await screen.findByText("Help & About")).toBeTruthy();

    expect(await pressBack(back)).toBe(true);
    expect(await screen.findByRole("button", { name: "Settings" })).toBeTruthy();

    expect(await pressBack(back)).toBe(false);
  });

  it("closes an open form before leaving its screen", async () => {
    const back = fakeBackButton();
    await mount(back);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Contacts"));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Add contact" }));
    });
    expect(await screen.findByPlaceholderText("Name")).toBeTruthy();

    expect(await pressBack(back)).toBe(true);
    expect(screen.queryByPlaceholderText("Name")).toBeNull();
    expect(screen.getByText("Contacts", { selector: "span" })).toBeTruthy();

    expect(await pressBack(back)).toBe(true);
    expect(await screen.findByText("Help & About")).toBeTruthy();
  });
});

describe("Lock & unlock passkey section", () => {
  async function openLockSettings(passkey: boolean) {
    const back = fakeBackButton();
    await mount(back, passkey);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Lock & unlock"));
    });
    await screen.findByText("Auto-lock");
  }

  it("is hidden where the shell has no passkeys", async () => {
    await openLockSettings(false);
    expect(screen.queryByText("Passkey")).toBeNull();
  });

  it("is shown where it does", async () => {
    await openLockSettings(true);
    expect(screen.getByText("Passkey")).toBeTruthy();
  });
});

describe("system back button while an action is in flight", () => {
  it("is consumed, not acted on, while a wallet reset is running", async () => {
    const back = fakeBackButton();
    const locked = { ...unlocked, session: null } as unknown as WalletState;
    let finishReset: () => void = () => {};
    const runtime: RuntimePort = {
      send: vi.fn(async ({ type }: { type: string }) => {
        if (type === "getState") return locked;
        if (type === "getThemePreference") return { theme: "light" };
        if (type === "resetAllWallets") return new Promise<void>((resolve) => (finishReset = resolve));
        return null;
      }) as unknown as RuntimePort["send"],
      onMessage: () => () => {},
    };
    await act(async () => {
      render(<App layout="phone" />, fakeAppPlatform({ runtime, backButton: back.port }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Forgot password?" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Reset wallet" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Yes, reset wallet" }));
    });
    expect(await screen.findByRole("button", { name: "Resetting…" })).toBeTruthy();

    expect(await pressBack(back)).toBe(true);
    expect(screen.getByRole("button", { name: "Resetting…" })).toBeTruthy();

    await act(async () => finishReset());
  });
});

