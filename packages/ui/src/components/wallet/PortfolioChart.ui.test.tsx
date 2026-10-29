import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PortfolioChart, type PortfolioChartProps } from "./PortfolioChart";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const BASE: PortfolioChartProps = {
  points: [
    { timestamp: 1, value: 10 },
    { timestamp: 2, value: 12 },
  ],
  currentValue: 12,
  currency: "USD",
  change: 0.2,
  periodLabel: "Last 7 days",
  activeRange: "7D",
  onRangeChange: () => {},
};

const figures = (container: HTMLElement) => container.querySelector("div.gap-0\\.5") as HTMLElement;

describe("PortfolioChart refreshing", () => {
  it("dims only after the refresh has run past the delay, and lightly", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<PortfolioChart {...BASE} />);
    rerender(<PortfolioChart {...BASE} refreshing />);
    expect(figures(container).className).not.toContain("opacity-85");
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(figures(container).className).toContain("opacity-85");
    expect(figures(container).className).toContain("duration-300");
    expect(figures(container).className).not.toContain("opacity-60");
  });

  it("never dims for a refresh that finishes quickly", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<PortfolioChart {...BASE} refreshing />);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    rerender(<PortfolioChart {...BASE} />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(figures(container).className).not.toContain("opacity-85");
  });
});

describe("PortfolioChart total", () => {
  it("keeps the cached total while held, then shows the settled one", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container, rerender } = render(<PortfolioChart {...BASE} currentValue={100} hold />);
    const before = container.textContent;
    rerender(<PortfolioChart {...BASE} currentValue={200} hold />);
    expect(container.textContent).toBe(before);
    rerender(<PortfolioChart {...BASE} currentValue={200} />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.textContent).toContain("200");
    vi.unstubAllGlobals();
  });
});
