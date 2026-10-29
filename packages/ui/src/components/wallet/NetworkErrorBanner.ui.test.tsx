import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NETWORK_RETRY_MIN_MS, NetworkErrorBanner } from "./NetworkErrorBanner";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("NetworkErrorBanner", () => {
  it("shows the retry working for a moment even when it fails at once", () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(<NetworkErrorBanner onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    const button = screen.getByRole("button", { name: "Retrying" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(NETWORK_RETRY_MIN_MS);
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("keeps showing the retry for as long as the caller's is in flight", () => {
    vi.useFakeTimers();
    const { rerender } = render(<NetworkErrorBanner onRetry={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    rerender(<NetworkErrorBanner onRetry={() => {}} retrying />);
    act(() => {
      vi.advanceTimersByTime(NETWORK_RETRY_MIN_MS * 3);
    });
    expect(screen.getByRole("button", { name: "Retrying" })).toBeTruthy();
    rerender(<NetworkErrorBanner onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
