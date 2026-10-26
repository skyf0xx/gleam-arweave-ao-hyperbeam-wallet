import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const built = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("qr-code-styling", () => ({
  default: class {
    constructor(options: Record<string, unknown>) {
      built.push(options);
    }
    append() {}
  },
}));

import { QrCode } from "./QrCode";

/** An image whose load result the test chooses. */
function stubImage(outcome: "load" | "error" | "hang") {
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        if (outcome === "hang") return;
        queueMicrotask(() => (outcome === "load" ? this.onload?.() : this.onerror?.()));
      }
    },
  );
}

beforeEach(() => {
  built.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("QrCode logo", () => {
  it("draws the code with the logo once it loads", async () => {
    stubImage("load");
    render(<QrCode value="addr" />);
    await vi.waitFor(() => expect(built).toHaveLength(1));
    expect(built[0]?.image).toBe("/icon/128.png");
  });

  it("still draws the code, without the logo, when the logo can't load", async () => {
    stubImage("error");
    render(<QrCode value="addr" />);
    await vi.waitFor(() => expect(built).toHaveLength(1));
    expect(built[0]?.data).toBe("addr");
    expect(built[0]).not.toHaveProperty("image");
  });

  it("gives up waiting on a logo that never answers and draws without it", () => {
    vi.useFakeTimers();
    try {
      stubImage("hang");
      render(<QrCode value="addr" />);
      expect(built).toHaveLength(0);
      vi.advanceTimersByTime(1499);
      expect(built).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(built).toHaveLength(1);
      expect(built[0]).not.toHaveProperty("image");
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws once even when the logo answers after the timeout", async () => {
    vi.useFakeTimers();
    try {
      stubImage("load");
      render(<QrCode value="addr" />);
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      expect(built).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
