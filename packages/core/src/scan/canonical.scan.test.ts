import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "./canonical";

describe("canonicalJson", () => {
  it("sorts keys recursively, keeps array order and adds no whitespace", () => {
    expect(canonicalJson({ b: [3, 1, { z: 1, a: 2 }], a: "x", c: null, d: true })).toBe(
      '{"a":"x","b":[3,1,{"a":2,"z":1}],"c":null,"d":true}',
    );
  });

  it("gives the same text whatever order the keys were added in", () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: 3 } })).toBe(canonicalJson({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("sorts by UTF-16 code unit and escapes strings as JSON does", () => {
    expect(canonicalJson({ b: 1, B: 2, é: 3, "\u{1F600}": 4 })).toBe('{"B":2,"b":1,"é":3,"😀":4}');
    expect(canonicalJson('quote " and \n newline')).toBe('"quote \\" and \\n newline"');
  });

  it("writes integers plainly and -0 as 0", () => {
    expect(canonicalJson([0, -0, 42, -7, Number.MAX_SAFE_INTEGER])).toBe("[0,0,42,-7,9007199254740991]");
  });

  it.each([
    ["undefined", undefined],
    ["a nested undefined", { a: undefined }],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["a fraction", 1.5],
    ["an unsafe integer", 2 ** 53],
    ["a function", () => 1],
    ["a bigint", 1n],
    ["a symbol", Symbol("x")],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["an array hole", new Array(3)],
  ])("refuses %s", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow();
  });

  it("refuses a cycle but allows a shared value", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const shared = { x: 1 };

    expect(() => canonicalJson(loop)).toThrow(/refers to itself/);
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});

describe("sha256Hex", () => {
  it("hashes the UTF-8 bytes", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(await sha256Hex("abc"));
  });
});
