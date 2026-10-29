import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useDelayedFlag } from "./use-delayed-flag";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe({ flag }: { flag: boolean }) {
  return <span>{String(useDelayedFlag(flag, 600))}</span>;
}

describe("useDelayedFlag", () => {
  it("turns on only after the flag has held for the delay", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Probe flag={false} />);
    rerender(<Probe flag />);
    await act(async () => {
      vi.advanceTimersByTime(599);
    });
    expect(container.textContent).toBe("false");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(container.textContent).toBe("true");
  });

  it("never turns on for a flag that clears within the delay", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Probe flag />);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    rerender(<Probe flag={false} />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toBe("false");
  });

  it("turns off at once", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Probe flag />);
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(container.textContent).toBe("true");
    rerender(<Probe flag={false} />);
    expect(container.textContent).toBe("false");
  });
});
