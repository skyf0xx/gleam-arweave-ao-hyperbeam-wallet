import { describe, expect, it } from "vitest";
import { SECURITY_PHRASE_ICON_COLORS, securityPhraseIconSvg } from "./security-phrase-icon";

const WORDS = ["amber", "anchor", "aurora", "basalt", "breeze", "cedar", "comet", "coral", "delta", "ember"];

describe("securityPhraseIconSvg", () => {
  it("draws the same icon for the same word, whatever its case or spacing", () => {
    expect(securityPhraseIconSvg(" Willow ")).toBe(securityPhraseIconSvg("willow"));
  });

  it("draws different icons for different words", () => {
    expect(new Set(WORDS.map(securityPhraseIconSvg)).size).toBeGreaterThan(WORDS.length / 2);
  });

  it("fills each icon with a palette colour, never beam red", () => {
    for (const word of WORDS) {
      const svg = securityPhraseIconSvg(word).toLowerCase();
      expect(SECURITY_PHRASE_ICON_COLORS.some((color) => svg.includes(color))).toBe(true);
      expect(svg).not.toContain("#ff1717");
    }
  });
});
