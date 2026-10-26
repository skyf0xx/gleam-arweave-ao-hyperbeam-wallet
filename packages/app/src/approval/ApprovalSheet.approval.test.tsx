import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ApprovalRequest, RuntimePort, WalletState } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "../app-platform/testing";
import type { ApprovalSheetPort } from "../app-platform/types";
import { ApprovalSheet } from "./ApprovalSheet";
import { BackStackContext, createBackStack } from "@gleam/ui/src/primitives/back-stack.tsx";

afterEach(() => {
  cleanup();
  layoutRoot.remove();
});

const REQUEST: ApprovalRequest = {
  requestId: "req-1",
  origin: "https://bazar.arweave.net",
  kind: "connect",
  preview: { kind: "connect", requestedPermissions: ["ACCESS_ADDRESS"], appInfo: null },
  createdAt: 0,
};

const STATE: WalletState = {
  wallets: [{ id: "w", address: "a", name: "Main", method: "jwk", publicKey: "p", createdAt: 0, updatedAt: 0, backupConfirmedAt: null }],
  activeWalletId: "w",
  session: { unlockedAt: 0, lastActivityAt: 0, autoLockTimeout: "never", unlockedWalletIds: ["w"] },
};

const runtime: RuntimePort = {
  send: (async (message: { type: string }) => {
    if (message.type === "getApproval") return REQUEST;
    if (message.type === "getState") return STATE;
    if (message.type === "getThemePreference") return { theme: "light" };
    if (message.type === "getSecurityPhrase") return null;
    throw new Error(`unexpected ${message.type}`);
  }) as RuntimePort["send"],
  onMessage: () => () => {},
};

function fakePort() {
  let onChange: (requestId: string | null) => void = () => {};
  const port: ApprovalSheetPort = {
    subscribe(listener) {
      onChange = listener;
      return () => {};
    },
    dismissed: vi.fn(),
  };
  return { port, show: (requestId: string | null) => act(() => onChange(requestId)) };
}

const layoutRoot = document.createElement("div");
layoutRoot.dataset.layout = "phone";

function mount(port: ApprovalSheetPort, backStack = createBackStack()) {
  document.body.append(layoutRoot);
  render(
    <BackStackContext.Provider value={backStack}>
      <ApprovalSheet port={port} container={layoutRoot} />
    </BackStackContext.Provider>,
    fakeAppPlatform({ runtime }),
  );
  return backStack;
}

describe("ApprovalSheet", () => {
  it("shows nothing until a request is shown", () => {
    const { port } = fakePort();

    mount(port);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the request inside the layout root", async () => {
    const { port, show } = fakePort();
    mount(port);

    await show("req-1");

    await screen.findByText(/bazar\.arweave\.net/);
    expect(layoutRoot.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("reports a dismissal when the user presses Escape", async () => {
    const { port, show } = fakePort();
    mount(port);
    await show("req-1");
    await screen.findByRole("dialog");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(port.dismissed).toHaveBeenCalledWith("req-1"));
  });

  it("reports a dismissal on the system back press", async () => {
    const { port, show } = fakePort();
    const backStack = mount(port);
    await show("req-1");
    await screen.findByRole("dialog");

    expect(backStack.handle()).toBe(true);

    expect(port.dismissed).toHaveBeenCalledWith("req-1");
  });

  it("closes without reporting when the shell takes the request down", async () => {
    const { port, show } = fakePort();
    mount(port);
    await show("req-1");
    await screen.findByRole("dialog");

    await show(null);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(port.dismissed).not.toHaveBeenCalled();
  });
});
