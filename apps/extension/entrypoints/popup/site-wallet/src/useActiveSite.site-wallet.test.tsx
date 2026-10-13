import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RuntimePort } from "@gleam/core";

type StorageListener = (changes: Record<string, unknown>, area: string) => void;
const storageListeners = new Set<StorageListener>();

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      onChanged: {
        addListener: (listener: StorageListener) => storageListeners.add(listener),
        removeListener: (listener: StorageListener) => storageListeners.delete(listener),
      },
    },
  },
}));

const { useActiveSite } = await import("./useActiveSite");

afterEach(() => {
  cleanup();
  storageListeners.clear();
});

function changeStorage(key: string, area: string): void {
  for (const listener of storageListeners) listener({ [key]: { newValue: {} } }, area);
}

function setup() {
  const send = vi.fn(async () => null);
  const runtime = { send: send as unknown as RuntimePort["send"], onMessage: vi.fn(() => () => {}) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useActiveSite(runtime), { wrapper });
  return { send, hook };
}

describe("useActiveSite", () => {
  it("reads the site again when a tab's other-wallet report changes", async () => {
    const { send } = setup();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    changeStorage("siteWallet:tab:7", "session");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });

  it("ignores other storage changes", async () => {
    const { send } = setup();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    changeStorage("wallets", "session");
    changeStorage("siteWallet:tab:7", "local");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops listening on unmount", async () => {
    const { send, hook } = setup();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    hook.unmount();
    expect(storageListeners.size).toBe(0);
  });
});
