import { describe, expect, it } from "vitest";
import { readSecurityPhrase, securityPhraseSeed, suggestSecurityPhrase } from "./security-phrase";

describe("readSecurityPhrase", () => {
  it("accepts a word, trimming it", () => {
    expect(readSecurityPhrase({ word: "  harbor  " })).toEqual({ word: "harbor" });
  });

  it("accepts words in any script, with inner spaces, apostrophes and hyphens", () => {
    expect(readSecurityPhrase({ word: "café du-nord" })?.word).toBe("café du-nord");
    expect(readSecurityPhrase({ word: "日本" })?.word).toBe("日本");
  });

  it("drops fields it doesn't know", () => {
    expect(readSecurityPhrase({ emoji: "🦊", word: "harbor" })).toEqual({ word: "harbor" });
  });

  it.each([
    ["a missing word", {}],
    ["a blank word", { word: "   " }],
    ["a word over the limit", { word: "a".repeat(25) }],
    ["markup in the word", { word: "<b>hi</b>" }],
    ["a word starting with punctuation", { word: "-harbor" }],
    ["a non-object", "harbor"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(readSecurityPhrase(value)).toBeNull();
  });
});

describe("securityPhraseSeed", () => {
  it("ignores case, surrounding space and Unicode form", () => {
    expect(securityPhraseSeed(" Willow ")).toBe("willow");
    expect(securityPhraseSeed("Café")).toBe(securityPhraseSeed("café"));
  });
});

describe("suggestSecurityPhrase", () => {
  it("suggests a phrase that reads back as valid", () => {
    for (const r of [0, 0.5, 0.999]) {
      const phrase = suggestSecurityPhrase(() => r);
      expect(readSecurityPhrase(phrase)).toEqual(phrase);
    }
  });

  it("never suggests the current word again", () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(suggestSecurityPhrase(() => r, "amber").word).not.toBe("amber");
    }
  });
});
