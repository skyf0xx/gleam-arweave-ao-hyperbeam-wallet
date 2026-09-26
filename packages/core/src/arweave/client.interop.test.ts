import ArweaveImport from "arweave";
import { describe, expect, it } from "vitest";
import { Arweave, resolveArweaveClass } from "./client";

describe("resolveArweaveClass", () => {
  it("returns the class when the default import is the class", () => {
    expect(resolveArweaveClass(ArweaveImport)).toBe(ArweaveImport);
  });

  it("unwraps `default` when the default import is the whole module.exports (Vite 8 Node-mode interop)", () => {
    const nodeModeImport = { default: ArweaveImport };
    expect(resolveArweaveClass(nodeModeImport)).toBe(ArweaveImport);
  });

  it("exports a class with a static `init`", () => {
    expect(typeof Arweave.init).toBe("function");
  });
});
