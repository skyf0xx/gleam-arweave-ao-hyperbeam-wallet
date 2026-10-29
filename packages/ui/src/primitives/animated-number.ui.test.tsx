import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ANIMATED_NUMBER_DURATION_MS, AnimatedNumber } from "./animated-number";

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

  it("ticks from the old figure and ends on the exact new text", async () => {
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container, rerender } = render(<AnimatedNumber value={10} text="$10.00" format={usd} />);

    rerender(<AnimatedNumber value={20} text="$20.000001" format={usd} />);
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
    const { container, rerender } = render(<AnimatedNumber value={1} text="1" />);
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
    const { container, rerender } = render(<AnimatedNumber value={10} text="$10.00" format={usd} />);
    rerender(<AnimatedNumber value={20} text="$20.00" format={usd} />);
    expect(container.textContent).toBe("$20.00");
  });

  it("swaps without ticking when the unit changes", () => {
    stubReducedMotion(false);
    const eur = (value: number) => `${value.toFixed(2)} €`;
    const { container, rerender } = render(<AnimatedNumber value={10} text="$10.00" format={usd} unit="USD" />);
    rerender(<AnimatedNumber value={9.2} text="9.20 €" format={eur} unit="EUR" />);
    expect(container.textContent).toBe("9.20 €");
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
    const { container, rerender } = render(<AnimatedNumber value={100} text="$100.00" format={usd} />);
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
    const { container, rerender } = render(<AnimatedNumber value={100} text="$100.00" format={usd} />);
    rerender(<AnimatedNumber value={100.5} text="$100.50" format={usd} />);
    expect(container.textContent).toBe("$100.50");
  });

  it("holds the last text while hold is set, then ticks once to the final value", async () => {
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container, rerender } = render(<AnimatedNumber value={100} text="$100.00" format={usd} hold />);
    rerender(<AnimatedNumber value={150} text="$150.00" format={usd} hold />);
    rerender(<AnimatedNumber value={200} text="$200.00" format={usd} hold />);
    await act(async () => {
      vi.advanceTimersByTime(ANIMATED_NUMBER_DURATION_MS * 2);
    });
    expect(container.textContent).toBe("$100.00");

    rerender(<AnimatedNumber value={200} text="$200.00" format={usd} hold={false} />);
    expect(container.textContent).toBe("$100.00");
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        vi.advanceTimersByTime(ANIMATED_NUMBER_DURATION_MS / 8);
      });
      seen.add(container.textContent ?? "");
    }
    expect(seen.has("$150.00")).toBe(false);
    expect([...seen].some((text) => text !== "$100.00" && text !== "$200.00")).toBe(true);
    expect(container.textContent).toBe("$200.00");
  });

  it("swaps on a unit change even while held", () => {
    stubReducedMotion(false);
    const eur = (value: number) => `${value.toFixed(2)} €`;
    const { container, rerender } = render(<AnimatedNumber value={10} text="$10.00" format={usd} unit="USD" hold />);
    rerender(<AnimatedNumber value={9.2} text="9.20 €" format={eur} unit="EUR" hold />);
    expect(container.textContent).toBe("9.20 €");
  });
});
