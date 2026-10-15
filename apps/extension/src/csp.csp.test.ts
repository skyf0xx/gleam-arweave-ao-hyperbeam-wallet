import { describe, expect, it } from "vitest";
import { extensionPagesCsp } from "./csp";

describe("extensionPagesCsp", () => {
  it("locks down production builds", () => {
    expect(extensionPagesCsp("build")).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'; connect-src https:",
    );
  });

  it("never allows eval or sets a default-src", () => {
    for (const command of ["build", "serve"] as const) {
      const csp = extensionPagesCsp(command);
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).not.toContain("default-src");
    }
  });

  it("lets the dev server's http and ws connections through only in serve mode", () => {
    expect(extensionPagesCsp("serve")).toContain("connect-src https: http://localhost:* ws://localhost:*");
    expect(extensionPagesCsp("build")).not.toContain("localhost");
  });
});
