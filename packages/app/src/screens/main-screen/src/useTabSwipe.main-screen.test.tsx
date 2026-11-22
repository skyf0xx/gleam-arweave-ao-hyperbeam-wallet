import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { useTabSwipe } from "./useTabSwipe";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({ layout = "phone", docked = true, initial = 0, onOpen = () => {} }: { layout?: string; docked?: boolean; initial?: number; onOpen?: () => void }) {
  const target = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(initial);
  const peek = useTabSwipe({ target, track, scroller, active, count: 3, docked, onPeek: () => {}, onSelect: setActive, onOpen });
  return (
    <div data-layout={layout}>
      <div ref={target} data-testid="target">
        <div ref={scroller}>
          <div
            ref={(element) => {
              track.current = element;
              if (element) Object.defineProperty(element, "clientWidth", { value: 360, configurable: true });
            }}
            data-testid="track"
          >
            {active}
          </div>
          <div data-testid="peek">{peek?.index ?? "none"}</div>
          <div data-testid="carousel" style={{ overflowX: "auto" }} />
        </div>
      </div>
    </div>
  );
}

const active = () => screen.getByTestId("track").textContent;

function swipe(dx: number, { dy = 0, from = 200, on = "target", end = true }: { dx?: number; dy?: number; from?: number; on?: string; end?: boolean } = {}) {
  const element = screen.getByTestId(on);
  fireEvent.touchStart(element, { touches: [{ clientX: from, clientY: 300 }] });
  fireEvent.touchMove(element, { touches: [{ clientX: from + Math.sign(dx) * 10, clientY: 300 + Math.sign(dy) * 10 * Math.abs(dy / (dx || 1)) }] });
  fireEvent.touchMove(element, { touches: [{ clientX: from + dx, clientY: 300 + dy }] });
  if (end) fireEvent.touchEnd(element, { touches: [] });
}

describe("useTabSwipe", () => {
  it("moves to the tab beside the active one, either way", () => {
    render(<Harness />);
    swipe(-180);
    expect(active()).toBe("1");
    swipe(180, { from: 100 });
    expect(active()).toBe("0");
  });

  it("follows the finger, with the next panel shown, until it lifts", () => {
    render(<Harness />);
    swipe(-110, { end: false });
    expect(screen.getByTestId("track").style.transform).toBe("translateX(-100px)");
    expect(screen.getByTestId("peek").textContent).toBe("1");
    expect(active()).toBe("0");
  });

  it("resists past either end and stays", () => {
    render(<Harness initial={2} />);
    swipe(-110, { end: false });
    expect(screen.getByTestId("track").style.transform).toBe("translateX(-25px)");
    fireEvent.touchEnd(screen.getByTestId("target"), { touches: [] });
    expect(active()).toBe("2");
  });

  it("ignores a vertical drag, a start at the screen's edge, and any layout but the phone's", () => {
    const { unmount } = render(<Harness />);
    swipe(-40, { dy: 200 });
    swipe(180, { from: 5 });
    expect(active()).toBe("0");
    unmount();
    render(<Harness layout="popup" />);
    swipe(-180);
    expect(active()).toBe("0");
  });

  it("leaves a swipe to a carousel until the carousel has no more to scroll", () => {
    render(<Harness />);
    const carousel = screen.getByTestId("carousel");
    Object.defineProperty(carousel, "scrollWidth", { value: 900 });
    Object.defineProperty(carousel, "clientWidth", { value: 300 });
    swipe(-180, { on: "carousel" });
    expect(active()).toBe("0");
    carousel.scrollLeft = 600;
    swipe(-180, { on: "carousel" });
    expect(active()).toBe("1");
  });

  it("undocked, opens the list first and changes tab once it has docked", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const { rerender } = render(<Harness docked={false} onOpen={onOpen} />);
    swipe(180, { from: 100 });
    expect(onOpen).not.toHaveBeenCalled();
    swipe(-180);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(active()).toBe("0");
    rerender(<Harness docked onOpen={onOpen} />);
    expect(active()).toBe("0");
    act(() => void vi.advanceTimersByTime(300));
    expect(active()).toBe("1");
  });
});
