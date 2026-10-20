import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_SCAN_FILE_BYTES, findFunction, listFunctions } from "./functions";
import { listSurfaceFunctions, parseSurfaceText, surfaceFiles } from "./surface";

const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf8");
const sample = fixture("sample.ts.txt");
const panel = fixture("panel.tsx.txt");

/** 1-based line of the only line containing `needle`. */
function lineOf(text: string, needle: string): number {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.includes(needle));
  if (index < 0 || lines.slice(index + 1).some((line) => line.includes(needle))) {
    throw new Error(`"${needle}" must occur on exactly one line`);
  }
  return index + 1;
}

describe("listFunctions", () => {
  it("lists every named function with a block body, in source order", () => {
    expect(listFunctions(sample, { jsx: false }).map((fn) => fn.symbol)).toEqual([
      "unlockVault",
      "isAllowedOrigin",
      "KeySession.create",
      "KeySession.get",
      "KeySession.clear",
      "KeySession.toString",
      "OtherSession.toString",
      "sign",
      "verify",
      "outer",
      "outer.helper",
      "another",
      "another.helper",
      "overloaded",
      "withTypeLiteral",
      "generator",
      "generic",
    ]);
  });

  it("skips expression-bodied arrows, one-line bodies and overload signatures", () => {
    const symbols = listFunctions(sample, { jsx: false }).map((fn) => fn.symbol);

    expect(symbols).not.toContain("shorthand");
    expect(symbols).not.toContain("oneLiner");
    expect(symbols.filter((symbol) => symbol === "overloaded")).toHaveLength(1);
  });

  it("ignores braces in strings, templates, comments and regex literals", () => {
    const fn = findFunction(sample, "unlockVault", { jsx: false });

    expect(fn).toEqual({
      symbol: "unlockVault",
      name: "unlockVault",
      startLine: lineOf(sample, "export async function unlockVault"),
      bodyStartLine: lineOf(sample, "export async function unlockVault"),
      endLine: lineOf(sample, "return { ok: label.length > 0 };") + 1,
    });
  });

  it("takes the body after a return type literal and a multi-line signature", () => {
    const fn = findFunction(sample, "withTypeLiteral", { jsx: false })!;

    expect(fn.startLine).toBe(lineOf(sample, "export default function withTypeLiteral("));
    expect(fn.bodyStartLine).toBe(lineOf(sample, "): { a: string } {"));
    expect(fn.endLine).toBe(lineOf(sample, "return input;") + 1);
  });

  it("starts a class member at its first modifier", () => {
    const fn = findFunction(sample, "KeySession.clear", { jsx: false })!;

    expect(fn.startLine).toBe(lineOf(sample, "private clear = "));
    expect(fn.endLine).toBe(lineOf(sample, "this.keys.delete(walletId);") + 1);
  });

  it("lexes JSX text, attributes and expression containers", () => {
    expect(listFunctions(panel, { jsx: true })).toEqual([
      {
        symbol: "ApprovalPanel",
        name: "ApprovalPanel",
        startLine: lineOf(panel, "export function ApprovalPanel"),
        bodyStartLine: lineOf(panel, "export function ApprovalPanel"),
        endLine: lineOf(panel, "</div>") + 2,
      },
      {
        symbol: "Banner",
        name: "Banner",
        startLine: lineOf(panel, "export const Banner"),
        bodyStartLine: lineOf(panel, "export const Banner"),
        endLine: lineOf(panel, "const isLong") + 2,
      },
      {
        symbol: "compare",
        name: "compare",
        startLine: lineOf(panel, "function compare"),
        bodyStartLine: lineOf(panel, "function compare"),
        endLine: lineOf(panel, "return a < b") + 1,
      },
    ]);
  });

  it("drops names that stay ambiguous after qualifying", () => {
    const text = [
      "class Box {",
      "  get size() {",
      "    return 1;",
      "  }",
      "  set size(value: number) {",
      "    void value;",
      "  }",
      "}",
      "function top() {",
      "  return 1;",
      "}",
      "function top() {",
      "  return 2;",
      "}",
    ].join("\n");

    expect(listFunctions(text, { jsx: false })).toEqual([]);
  });

  it("qualifies a repeated name by its enclosing const object", () => {
    const text = [
      "const a = {",
      "  run() {",
      "    return 1;",
      "  },",
      "};",
      "const b = {",
      "  run() {",
      "    return 2;",
      "  },",
      "};",
    ].join("\n");

    expect(listFunctions(text, { jsx: false }).map((fn) => fn.symbol)).toEqual(["a.run", "b.run"]);
  });
});

describe("listFunctions on awkward input", () => {
  const span = (text: string, symbol: string, jsx = false) => findFunction(text, symbol, { jsx });

  it("reads `/` after a postfix ++ or -- as division", () => {
    const text = [
      "function count(i: number, j: number) {",
      "  const half = i++ / 2;",
      "  const r = { a: 1 };",
      "  const back = j-- / 2;",
      "  return { half, r, back };",
      "}",
    ].join("\n");

    expect(span(text, "count")).toMatchObject({ bodyStartLine: 1, endLine: 6 });
  });

  it("still reads a regex after a prefix operator's operand", () => {
    const text = ["function f(x: number) {", "  const ok = ++x > 0 && /}/.test(String(x));", "  return ok;", "}"].join(
      "\n",
    );

    expect(span(text, "f")).toMatchObject({ endLine: 4 });
  });

  it("numbers lines by \\n alone, so CRLF and a BOM don't shift them", () => {
    const lf = ["function f(x: number) {", "  if (x) throw new Error();", "  return x;", "}", "function g() {", "  return 1;", "}"];
    const crlf = `\uFEFF${lf.join("\r\n")}`;

    expect(listFunctions(crlf, { jsx: false })).toEqual(listFunctions(lf.join("\n"), { jsx: false }));
    expect(span(crlf, "g")).toMatchObject({ startLine: 5, endLine: 7 });
  });

  it("ends a // comment at U+2028 without starting a new numbered line", () => {
    const text = ["function f(x: number) {", "  // note\u2028if (x) {", "    return 1;", "  }", "  return 0;", "}"].join("\n");

    expect(span(text, "f")).toMatchObject({ bodyStartLine: 1, endLine: 6 });
  });

  it("survives deeply nested templates and JSX without throwing", () => {
    const depth = 5000;
    const template = `function f() {\n  return ${"`${".repeat(depth)}x${"}`".repeat(depth)};\n}\n`;
    const jsx = `function C() {\n  return ${"<a>{".repeat(depth)}x${"}</a>".repeat(depth)};\n}\n`;

    expect(span(template, "f")).toMatchObject({ endLine: 3 });
    expect(span(jsx, "C", true)).toMatchObject({ endLine: 3 });
    expect(() => listFunctions("`${".repeat(depth), { jsx: false })).not.toThrow();
    expect(() => listFunctions("<a>".repeat(depth), { jsx: true })).not.toThrow();
  });

  it("finishes a large or pathological file quickly", () => {
    const body = (index: number) => `export function f${index}(x: number) {\n  if (x < ${index}) throw new Error("${index}");\n  return x;\n}\n`;
    const many = Array.from({ length: 10_000 }, (_, index) => body(index)).join("");
    const angles = `const x = ${"a < b, ".repeat(50_000)}c;\n`;
    const nested = `${"function n() {\n".repeat(3000)}if (x) throw 1;\n${"}\n".repeat(3000)}`;
    expect(many.length).toBeLessThan(MAX_SCAN_FILE_BYTES);

    const started = performance.now();
    expect(listFunctions(many, { jsx: false })).toHaveLength(10_000);
    listFunctions(angles, { jsx: false });
    listFunctions(nested, { jsx: false });
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe("the repo's security surface", () => {
  const root = resolve(__dirname, "../../../..");
  const entries = parseSurfaceText(readFileSync(join(root, "security/surface.txt"), "utf8"));
  const repoPaths = entries.flatMap((entry) =>
    entry.path.endsWith("/")
      ? readdirSync(join(root, entry.path), { recursive: true, encoding: "utf8" })
          .filter((relative) => !relative.split("/").includes("node_modules"))
          .map((relative) => `${entry.path}${relative}`)
      : [entry.path],
  );
  const files = surfaceFiles(entries, repoPaths);
  const functions = listSurfaceFunctions(files.map((path) => ({ path, text: readFileSync(join(root, path), "utf8") })));

  it("finds a few hundred checking functions across the surface's source files", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(functions.length).toBeGreaterThan(200);
  });

  it("gives every function a unique symbol within its file and a sane span", () => {
    const keys = functions.map((fn) => `${fn.file}\n${fn.symbol}`);

    expect(new Set(keys).size).toBe(keys.length);
    for (const fn of functions) expect(fn.endLine).toBeGreaterThan(fn.startLine);
  });

  it("knows the signing and key functions a challenge should reach", () => {
    const symbols = new Set(functions.map((fn) => `${fn.file}#${fn.symbol}`));

    expect(symbols).toContain("packages/core/src/vault/encryption.ts#normalizeEncryptAlgorithm");
    expect(symbols).toContain("apps/extension/src/handlers/provider-params.ts#readTransaction");
    expect(symbols).toContain("apps/extension/src/handlers/approval.ts#ApprovalHandler.resolveApproval");
  });
});
