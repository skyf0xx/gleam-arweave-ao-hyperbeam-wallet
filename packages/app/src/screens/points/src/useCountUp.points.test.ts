import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCountUp } from "./useCountUp";

const P = 10n ** 12n;

type Props = { value: string; trigger: string | null };

function stubMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
}

function mount(initial: Props) {
  return renderHook(({ value, trigger }: Props) => useCountUp(value, trigger), { initialProps: initial });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "performance"] });
  stubMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCountUp", () => {
  it("does not animate the first load or the per-second ticks", () => {
    const { result, rerender } = mount({ value: "0", trigger: null });
    rerender({ value: (5n * P).toString(), trigger: (5n * P).toString() });
    expect(result.current).toEqual({ shown: (5n * P).toString(), highlighted: false });
    rerender({ value: (5n * P + 10n).toString(), trigger: (5n * P).toString() });
    expect(result.current).toEqual({ shown: (5n * P + 10n).toString(), highlighted: false });
  });

  it("counts up from the old total and highlights when the settled total grows", () => {
    const { result, rerender } = mount({ value: (5n * P).toString(), trigger: (5n * P).toString() });
    rerender({ value: (105n * P).toString(), trigger: (100n * P).toString() });
    expect(result.current.shown).toBe((5n * P).toString());
    expect(result.current.highlighted).toBe(true);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    const midway = BigInt(result.current.shown);
    expect(midway > 5n * P && midway < 105n * P).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.shown).toBe((105n * P).toString());

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.highlighted).toBe(false);
  });

  it("jumps straight to the new total under reduced motion", () => {
    stubMotion(true);
    const { result, rerender } = mount({ value: (5n * P).toString(), trigger: (5n * P).toString() });
    rerender({ value: (105n * P).toString(), trigger: (100n * P).toString() });
    expect(result.current).toEqual({ shown: (105n * P).toString(), highlighted: false });
  });
});
