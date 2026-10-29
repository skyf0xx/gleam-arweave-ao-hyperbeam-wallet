import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ANIMATED_NUMBER_DURATION_MS, AnimatedNumber as BareAnimatedNumber, type AnimatedNumberProps } from "./animated-number";

function AnimatedNumber(props: Omit<AnimatedNumberProps, "identity" | "cached"> & Partial<Pick<AnimatedNumberProps, "identity" | "cached">>) {
  return <BareAnimatedNumber identity="a" cached={false} {...props} />;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const usd = (value: number) => `$${value.toFixed(2)}`;

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query }));
}

describe("AnimatedNumber", () => {
  it("shows the first value as is", () => {
    const { container } = render(<AnimatedNumber value={12.5} text="12.5" />);
    expect(container.textContent).toBe("12.5");
  });

  it("ticks once from the cached figure to the live one and ends on the exact new text", async () => {
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container, rerender } = render(<AnimatedNumber value={10} text="$10.00" format={usd} cached />);

    rerender(<AnimatedNumber value={20} text="$20.000001" format={usd} cached={false} />);
    expect(container.textContent).toBe("$10.00");

    await act(async () => {
      vi.advanceTimersByTime(ANIMATED_NUMBER_DURATION_MS / 4);
    });
    const midway = container.textContent ?? "";
    expect(midway).not.toBe("$10.00");
    expect(midway).not.toBe("$20.000001");

    await act(async () => {
      vi.advanceTimersByTime(ANIMATED_NUMBER_DURATION_MS);
    });
    expect(container.textContent).toBe("$20.000001");
  });

  it("draws frames for a plain decimal at the final text's precision", async () => {
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container, rerender } = render(<AnimatedNumber value={1} text="1" cached />);
    rerender(<AnimatedNumber value={2.5} text="2.5" />);
    await act(async () => {
      vi.advanceTimersByTime(ANIMATED_NUMBER_DURATION_MS / 4);
    });
    expect(container.textContent).toMatch(/^\d\.\d$/);
    await act(async () => {
      vi.advanceTimersByTime(ANIMATED_NUMBER_DURATION_MS);
    });
    expect(container.textContent).toBe("2.5");
  });

  it("swaps straight to the new text under reduced motion", () => {
    stubReducedMotion(true);
    const { container, rerender } = render(<AnimatedNumber value={10} text="$10.00" format={usd} cached />);
    rerender(<AnimatedNumber value={20} text="$20.00" format={usd} />);
    expect(container.textContent).toBe("$20.00");
  });

  it("swaps without ticking when the identity changes, even as it goes live", () => {
    stubReducedMotion(false);
    const { container, rerender } = render(<AnimatedNumber value={10} text="$10.00" format={usd} identity="7D" cached />);
    rerender(<AnimatedNumber value={90} text="$90.00" format={usd} identity="1Y" />);
    expect(container.textContent).toBe("$90.00");
  });

  it("swaps a live change without ticking", () => {
    stubReducedMotion(false);
    const { container, rerender } = render(<AnimatedNumber value={10} text="$10.00" format={usd} />);
    rerender(<AnimatedNumber value={20} text="$20.00" format={usd} />);
    expect(container.textContent).toBe("$20.00");
  });

  it("ticks a new identity once it goes from cached to live", async () => {
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container, rerender } = render(<AnimatedNumber value={10} text="$10.00" format={usd} identity="7D" />);
    rerender(<AnimatedNumber value={90} text="$90.00" format={usd} identity="1Y" cached />);
    expect(container.textContent).toBe("$90.00");
    rerender(<AnimatedNumber value={100} text="$100.00" format={usd} identity="1Y" />);
    expect(container.textContent).toBe("$90.00");
    await act(async () => {
      vi.advanceTimersByTime(ANIMATED_NUMBER_DURATION_MS);
    });
    expect(container.textContent).toBe("$100.00");
  });

  it("swaps when the old figure was a stand-in", () => {
    stubReducedMotion(false);
    const { container, rerender } = render(<AnimatedNumber value={Number.NaN} text="0" />);
    rerender(<AnimatedNumber value={3} text="3" />);
    expect(container.textContent).toBe("3");
  });

  it("ticks with easeOutQuart: most of the way there well before the end", async () => {
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container, rerender } = render(<AnimatedNumber value={100} text="$100.00" format={usd} cached />);
    rerender(<AnimatedNumber value={200} text="$200.00" format={usd} />);
    await act(async () => {
      vi.advanceTimersByTime(ANIMATED_NUMBER_DURATION_MS / 2);
    });
    // easeOutQuart at 0.5 is 0.9375.
    expect(Number(container.textContent?.slice(1))).toBeGreaterThan(190);
  });

  it("swaps without ticking when the change is under 1%", async () => {
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container, rerender } = render(<AnimatedNumber value={100} text="$100.00" format={usd} cached />);
    rerender(<AnimatedNumber value={100.5} text="$100.50" format={usd} />);
    expect(container.textContent).toBe("$100.50");
  });
});
