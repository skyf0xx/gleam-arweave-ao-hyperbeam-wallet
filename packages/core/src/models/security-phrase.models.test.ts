import { describe, expect, it } from "vitest";
import { SECURITY_PHRASE_EMOJI, readSecurityPhrase, suggestSecurityPhrase } from "./security-phrase";

describe("readSecurityPhrase", () => {
  it("accepts a listed emoji and a word, trimming the word", () => {
    expect(readSecurityPhrase({ emoji: "🦊", word: "  harbor  " })).toEqual({ emoji: "🦊", word: "harbor" });
  });

  it("accepts words in any script, with inner spaces, apostrophes and hyphens", () => {
    expect(readSecurityPhrase({ emoji: "🌊", word: "café du-nord" })?.word).toBe("café du-nord");
    expect(readSecurityPhrase({ emoji: "🌊", word: "日本" })?.word).toBe("日本");
  });

  it.each([
    ["an unlisted emoji", { emoji: "💀", word: "harbor" }],
    ["a missing word", { emoji: "🦊" }],
    ["a blank word", { emoji: "🦊", word: "   " }],
    ["a word over the limit", { emoji: "🦊", word: "a".repeat(25) }],
    ["markup in the word", { emoji: "🦊", word: "<b>hi</b>" }],
    ["a word starting with punctuation", { emoji: "🦊", word: "-harbor" }],
    ["a non-object", "🦊 harbor"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(readSecurityPhrase(value)).toBeNull();
  });
});

describe("suggestSecurityPhrase", () => {
  it("suggests a phrase that reads back as valid", () => {
    for (const r of [0, 0.5, 0.999]) {
      const phrase = suggestSecurityPhrase(() => r);
      expect(readSecurityPhrase(phrase)).toEqual(phrase);
      expect(SECURITY_PHRASE_EMOJI).toContain(phrase.emoji);
    }
  });
});
