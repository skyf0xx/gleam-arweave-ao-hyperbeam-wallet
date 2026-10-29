import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { usePullToRefresh } from "./use-pull-to-refresh";

afterEach(cleanup);

function touch(el: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  Object.assign(event, { touches: type === "touchend" ? [] : [point] });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

function Harness({ onRefresh, layout = "phone" }: { onRefresh: () => Promise<unknown>; layout?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { pull, refreshing } = usePullToRefresh({ target: ref, onRefresh });
  return (
    <div data-layout={layout}>
      <div ref={ref} data-testid="root" data-pull={pull} data-refreshing={refreshing} />
    </div>
  );
}

function drag(el: Element, dx: number, dy: number) {
  touch(el, "touchstart", 100, 100);
  const move = touch(el, "touchmove", 100 + dx, 100 + dy);
  touch(el, "touchend", 100 + dx, 100 + dy);
  return move;
}

describe("usePullToRefresh", () => {
  it("refreshes when released past the threshold and cancels the scroll while pulling", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    const move = drag(getByTestId("root"), 0, 140);
    expect(move.defaultPrevented).toBe(true);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(getByTestId("root").dataset.pull).toBe("0");
  });

  it("does not refresh when released short of the threshold", () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    drag(getByTestId("root"), 0, 60);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(getByTestId("root").dataset.pull).toBe("0");
  });

  it("rejects a horizontal swipe without cancelling it", () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    const move = drag(getByTestId("root"), 120, 30);
    expect(move.defaultPrevented).toBe(false);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores an upward drag and a drag that starts scrolled down", () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    expect(drag(getByTestId("root"), 0, -140).defaultPrevented).toBe(false);
    Object.defineProperty(window, "scrollY", { value: 40, configurable: true });
    try {
      expect(drag(getByTestId("root"), 0, 140).defaultPrevented).toBe(false);
    } finally {
      Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    }
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does nothing outside the phone layout", () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { getByTestId } = render(<Harness onRefresh={onRefresh} layout="popup" />);
    drag(getByTestId("root"), 0, 140);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does nothing while a refresh is in flight", async () => {
    let finish!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    drag(getByTestId("root"), 0, 140);
    drag(getByTestId("root"), 0, 140);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    drag(getByTestId("root"), 0, 140);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});
