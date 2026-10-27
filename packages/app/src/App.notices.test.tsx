import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import type { RuntimePort, WalletState } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "./app-platform/testing";
import type { NoticePort } from "./app-platform/types";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const locked = { wallets: [], activeWalletId: null, session: null } as unknown as WalletState;

const runtime: RuntimePort = {
  send: vi.fn(async ({ type }: { type: string }) => (type === "getState" ? locked : type === "getThemePreference" ? { theme: "light" } : null)) as unknown as RuntimePort["send"],
  onMessage: () => () => {},
};

function fakeNotices() {
  let emit: (message: string) => void = () => {};
  const port: NoticePort = {
    subscribe(next) {
      emit = next;
      return () => {
        emit = () => {};
      };
    },
  };
  return { port, emit: (message: string) => emit(message) };
}

describe("host notices", () => {
  it("shows the host's sentence, then clears it", async () => {
    const notices = fakeNotices();
    await act(async () => {
      render(<App layout="phone" />, fakeAppPlatform({ runtime, notices: notices.port }));
    });
    vi.useFakeTimers();

    act(() => notices.emit("This wallet can't sign for Gleam Points."));
    expect(screen.getByText("This wallet can't sign for Gleam Points.")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText("This wallet can't sign for Gleam Points.")).toBeNull();
  });

  it("shows nothing when the host sends nothing", async () => {
    await act(async () => {
      render(<App layout="phone" />, fakeAppPlatform({ runtime }));
    });
    expect(screen.queryByText(/Gleam Points/)).toBeNull();
  });
});
