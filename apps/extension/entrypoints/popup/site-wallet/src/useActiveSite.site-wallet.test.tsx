import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RuntimePort } from "@gleam/core";
import { PlatformProvider } from "@/src/app-platform/context";
import { fakeAppPlatform } from "@/src/app-platform/testing";
import { useActiveSite } from "./useActiveSite";

const listeners = new Set<() => void>();
const platform = fakeAppPlatform({
  activeSite: {
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  },
});

afterEach(() => {
  cleanup();
  listeners.clear();
});

function changeActiveSite(): void {
  for (const listener of listeners) listener();
}

function setup() {
  const send = vi.fn(async () => null);
  const runtime = { send: send as unknown as RuntimePort["send"], onMessage: vi.fn(() => () => {}) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider platform={platform}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </PlatformProvider>
  );
  const hook = renderHook(() => useActiveSite(runtime), { wrapper });
  return { send, hook };
}

describe("useActiveSite", () => {
  it("reads the site again when the platform reports a change", async () => {
    const { send } = setup();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    changeActiveSite();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });

  it("stops listening on unmount", async () => {
    const { send, hook } = setup();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    hook.unmount();
    expect(listeners.size).toBe(0);
  });
});
