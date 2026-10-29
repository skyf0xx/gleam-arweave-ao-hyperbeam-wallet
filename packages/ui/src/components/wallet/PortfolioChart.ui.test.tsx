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

describe("PortfolioChart cached", () => {
  it("renders faded from the first frame, with no delay", () => {
    const { container } = render(<PortfolioChart {...BASE} cached />);
    expect(figures(container).className).toContain("opacity-70");
  });

  it("pulses while fetching and rests still when not", () => {
    const { container, rerender } = render(<PortfolioChart {...BASE} cached cachedFetching />);
    expect(figures(container).className).toContain("gleam-cached-pulse");
    expect(figures(container).className).not.toContain("opacity-70");
    rerender(<PortfolioChart {...BASE} cached />);
    expect(figures(container).className).toContain("opacity-70");
    expect(figures(container).className).not.toContain("gleam-cached-pulse");
  });

  it("fades up to full when fresh data lands", () => {
    const { container, rerender } = render(<PortfolioChart {...BASE} cached />);
    rerender(<PortfolioChart {...BASE} />);
    const className = figures(container).className;
    expect(className).not.toContain("opacity-70");
    expect(className).toContain("duration-500");
    expect(className).toContain("ease-out");
  });

  it("renders never-cached data at full", () => {
    const { container } = render(<PortfolioChart {...BASE} />);
    expect(figures(container).className).not.toContain("opacity-70");
  });
});

describe("PortfolioChart total", () => {
  const motion = () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  };

  it("ticks from the cached total to the live one, ending on the live text", async () => {
    motion();
    const { container, rerender } = render(<PortfolioChart {...BASE} currentValue={100} cached />);
    const before = container.textContent;
    rerender(<PortfolioChart {...BASE} currentValue={200} />);
    expect(container.textContent).toBe(before);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.textContent).toContain("200");
    vi.unstubAllGlobals();
  });

  it("swaps the total without a tick when the range changes", () => {
    motion();
    const { container, rerender } = render(<PortfolioChart {...BASE} currentValue={100} cached />);
    rerender(<PortfolioChart {...BASE} currentValue={200} activeRange="1Y" />);
    expect(container.textContent).toContain("200");
    vi.unstubAllGlobals();
  });
});
