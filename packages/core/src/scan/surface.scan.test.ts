import { describe, expect, it } from "vitest";
import { isScannablePath, listSurfaceFunctions, parseSurfaceText, surfaceFiles } from "./surface";

const SURFACE = [
  "# The security surface.",
  "",
  "1 packages/core/src/vault/",
  "2   apps/extension/src/handlers/transfer.ts  ",
  "5 pnpm-lock.yaml",
  "5 .github/",
].join("\n");

describe("parseSurfaceText", () => {
  it("reads tier and path, skipping comments and blank lines", () => {
    expect(parseSurfaceText(SURFACE)).toEqual([
      { tier: 1, path: "packages/core/src/vault/" },
      { tier: 2, path: "apps/extension/src/handlers/transfer.ts" },
      { tier: 5, path: "pnpm-lock.yaml" },
      { tier: 5, path: ".github/" },
    ]);
  });

  it.each(["6 a.ts", "x a.ts", "1", "1 a.ts extra"])("throws on %j", (line) => {
    expect(() => parseSurfaceText(line)).toThrow(/malformed surface line/);
  });
});

describe("isScannablePath", () => {
  it.each([
    ["a/b.ts", true],
    ["a/B.tsx", true],
    ["a/b.vault.test.ts", false],
    ["a/b.test.tsx", false],
    ["a/b.spec.ts", false],
    ["a/b.d.ts", false],
    ["a/b.mjs", false],
    ["pnpm-lock.yaml", false],
    [".github/workflows/ci.yml", false],
  ])("%s → %s", (path, expected) => {
    expect(isScannablePath(path)).toBe(expected);
  });
});

describe("surfaceFiles", () => {
  it("expands directories, matches files exactly and keeps only scannable source", () => {
    const repoPaths = [
      "packages/core/src/vault/encryption.ts",
      "packages/core/src/vault/encryption.vault.test.ts",
      "packages/core/src/vault/nested/deep.ts",
      "packages/core/src/vaulted.ts",
      "apps/extension/src/handlers/transfer.ts",
      "apps/extension/src/handlers/transfer-extra.ts",
      "pnpm-lock.yaml",
      ".github/workflows/ci.yml",
      "packages/core/src/vault/encryption.ts",
    ];

    expect(surfaceFiles(parseSurfaceText(SURFACE), repoPaths)).toEqual([
      "apps/extension/src/handlers/transfer.ts",
      "packages/core/src/vault/encryption.ts",
      "packages/core/src/vault/nested/deep.ts",
    ]);
  });
});

describe("listSurfaceFunctions", () => {
  const symbolsOf = (text: string) => listSurfaceFunctions([{ path: "a.ts", text }]).map((fn) => fn.symbol);

  it("lists functions per file, files sorted by path", () => {
    const body = (name: string) => `export function ${name}(x: number) {\n  if (x) throw new Error();\n}\n`;

    expect(
      listSurfaceFunctions([
        { path: "b.ts", text: body("second") },
        { path: "a.tsx", text: body("first") },
      ]),
    ).toEqual([
      { file: "a.tsx", symbol: "first", startLine: 1, endLine: 3 },
      { file: "b.ts", symbol: "second", startLine: 1, endLine: 3 },
    ]);
  });

  it("keeps only functions whose own body has an if, throw or switch", () => {
    const text = [
      "function guarded(x: number) {",
      "  if (x < 0) return 0;",
      "  return x;",
      "}",
      "function thrower() {",
      "  throw new Error();",
      "}",
      "function router(kind: string) {",
      "  switch (kind) {",
      "    case 'a':",
      "      return 1;",
      "  }",
      "  return 0;",
      "}",
      "function plain() {",
      "  return 1;",
      "}",
    ].join("\n");

    expect(symbolsOf(text)).toEqual(["guarded", "thrower", "router"]);
  });

  it("counts a guard in a nested function only for that function", () => {
    const text = [
      "function outer(items: number[]) {",
      "  const ok = items.every((item) => {",
      "    if (item < 0) return false;",
      "    return true;",
      "  });",
      "  function inner(value: number) {",
      "    if (value) throw new Error();",
      "  }",
      "  const named = (value: number) => {",
      "    if (value) return 1;",
      "  };",
      "  return ok && inner(1) && named(1);",
      "}",
    ].join("\n");

    expect(symbolsOf(text)).toEqual(["inner", "named"]);
  });

  it("ignores the keywords in strings, comments, template text and property names", () => {
    const text = [
      "function quiet(event: { if: number }) {",
      '  const words = "if throw switch";',
      "  // if (x) throw new Error();",
      "  /* switch (x) {} */",
      "  const text = `if ${words} throw`;",
      "  return event.if + text.length;",
      "}",
    ].join("\n");

    expect(symbolsOf(text)).toEqual([]);
  });

  it("counts a guard only on a citable body line, not in the signature", () => {
    const text = [
      "function defaulted(x = (() => { if (1) return 1; })()) {",
      "  return x;",
      "}",
      "function inline(x: number) { if (x) {",
      "  return x;",
      "} }",
    ].join("\n");

    expect(symbolsOf(text)).toEqual([]);
  });

  it("doesn't credit an outer function with a computed- or string-keyed method's guard", () => {
    const text = [
      "function factory(key: string) {",
      "  return {",
      "    [key](x: number) {",
      "      if (x) throw new Error();",
      "    },",
      '    "quoted"(x: number) {',
      "      if (x) throw new Error();",
      "    },",
      "  };",
      "}",
    ].join("\n");

    expect(symbolsOf(text)).toEqual([]);
  });
});
