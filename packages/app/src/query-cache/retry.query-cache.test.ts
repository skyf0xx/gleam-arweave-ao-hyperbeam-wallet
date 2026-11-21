import { describe, expect, it } from "vitest";
import { FAILED_READ_RETRY_MS, retryWhileFailed } from "./retry";

describe("retryWhileFailed", () => {
  it("asks again only while the read is failed", () => {
    expect(retryWhileFailed({ state: { status: "error" } } as never)).toBe(FAILED_READ_RETRY_MS);
    expect(retryWhileFailed({ state: { status: "success" } } as never)).toBe(false);
    expect(retryWhileFailed({ state: { status: "pending" } } as never)).toBe(false);
  });
});
