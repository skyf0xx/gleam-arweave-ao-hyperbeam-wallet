import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ScreenHeader } from "./screen-header";
import { BackStackContext, createBackStack, useBackHandler } from "./back-stack";

describe("createBackStack", () => {
  it("asks the newest entry first", () => {
    const stack = createBackStack();
    const screen = vi.fn();
    const overlay = vi.fn();
    stack.register(() => screen);
    stack.register(() => overlay);
    expect(stack.handle()).toBe(true);
    expect(overlay).toHaveBeenCalledOnce();
    expect(screen).not.toHaveBeenCalled();
  });

  it("falls through entries with nothing to undo", () => {
    const stack = createBackStack();
    const screen = vi.fn();
    stack.register(() => screen);
    stack.register(() => null);
    expect(stack.handle()).toBe(true);
    expect(screen).toHaveBeenCalledOnce();
  });

  it("reports false when nothing is registered or nothing can go back", () => {
    const stack = createBackStack();
    expect(stack.handle()).toBe(false);
    stack.register(() => null);
    expect(stack.handle()).toBe(false);
  });

  it("forgets an entry once removed", () => {
    const stack = createBackStack();
    const remove = stack.register(() => vi.fn());
    remove();
    expect(stack.handle()).toBe(false);
  });
});

describe("useBackHandler", () => {
  function Probe({ onBack }: { onBack: (() => void) | null }) {
    useBackHandler(onBack);
    return null;
  }

  it("registers while mounted and calls the latest handler", () => {
    const stack = createBackStack();
    const first = vi.fn();
    const second = vi.fn();
    const view = render(
      <BackStackContext.Provider value={stack}>
        <Probe onBack={first} />
      </BackStackContext.Provider>,
    );
    view.rerender(
      <BackStackContext.Provider value={stack}>
        <Probe onBack={second} />
      </BackStackContext.Provider>,
    );
    expect(stack.handle()).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    view.unmount();
    expect(stack.handle()).toBe(false);
  });

  it("does nothing without a stack above it", () => {
    expect(() => render(<Probe onBack={vi.fn()} />)).not.toThrow();
  });

  it("consumes the press without going back while a ScreenHeader is busy", () => {
    const stack = createBackStack();
    const onBack = vi.fn();
    const view = render(
      <BackStackContext.Provider value={stack}>
        <ScreenHeader title="Review" onBack={onBack} busy />
      </BackStackContext.Provider>,
    );
    expect(stack.handle()).toBe(true);
    expect(onBack).not.toHaveBeenCalled();

    view.rerender(
      <BackStackContext.Provider value={stack}>
        <ScreenHeader title="Review" onBack={onBack} />
      </BackStackContext.Provider>,
    );
    expect(stack.handle()).toBe(true);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
