import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("PortfolioChart empty wallet", () => {
  it("drops the change and range tabs while the wallet holds nothing, and brings them back once it does", () => {
    const empty = { ...BASE, points: [{ timestamp: 1, value: 0 }, { timestamp: 2, value: 0 }], currentValue: 0, change: 0 };
    const { rerender } = render(<PortfolioChart {...empty} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("0.00%")).toBeNull();

    rerender(<PortfolioChart {...BASE} />);
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});

describe("PortfolioChart first load", () => {
  it("shows a shimmer in place of the total, not a made-up figure", () => {
    render(<PortfolioChart {...BASE} points={[]} currentValue={0} loading />);
    expect(screen.getByTestId("figure-placeholder")).toBeTruthy();
  });

  it("shows the figure once it loads", () => {
    const { rerender } = render(<PortfolioChart {...BASE} loading />);
    rerender(<PortfolioChart {...BASE} />);
    expect(screen.queryByTestId("figure-placeholder")).toBeNull();
  });
});

describe("PortfolioChart cached", () => {
  it("renders restored figures at full strength", () => {
    const { container } = render(<PortfolioChart {...BASE} cached />);
    expect(figures(container).className).not.toContain("opacity-70");
    expect(figures(container).className).not.toContain("gleam-shimmer");
    expect(figures(container).className).not.toContain("gleam-fresh");
  });

  it("settles once when fresh data lands", () => {
    const { container, rerender } = render(<PortfolioChart {...BASE} cached />);
    rerender(<PortfolioChart {...BASE} />);
    expect(figures(container).className).toContain("gleam-fresh");
  });

  it("gives never-cached data no settle", () => {
    const { container } = render(<PortfolioChart {...BASE} />);
    expect(figures(container).className).not.toContain("gleam-fresh");
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

describe("PortfolioChart minimal", () => {
  it("steps to the next range when the range is tapped, wrapping after ALL", () => {
    const onRangeChange = vi.fn();
    const { rerender } = render(<PortfolioChart {...BASE} layout="minimal" onRangeChange={onRangeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "7D" }));
    expect(onRangeChange).toHaveBeenLastCalledWith("1M");

    rerender(<PortfolioChart {...BASE} layout="minimal" activeRange="ALL" onRangeChange={onRangeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "ALL" }));
    expect(onRangeChange).toHaveBeenLastCalledWith("24H");
  });

  it("toggles the wallet scope from the space beside the figures, only with more than one wallet", () => {
    const onToggleScope = vi.fn();
    const { rerender } = render(<PortfolioChart {...BASE} layout="minimal" />);
    expect(screen.queryByRole("button", { name: "Show all wallets" })).toBeNull();

    rerender(<PortfolioChart {...BASE} layout="minimal" onToggleScope={onToggleScope} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all wallets" }));
    expect(onToggleScope).toHaveBeenCalledOnce();
    expect(screen.getByText("All wallets")).toBeTruthy();
  });
});
