/**
 * A word the user picks, shown with the icon drawn from it on Gleam's
 * unlock and approval screens. A fake Gleam window drawn inside a web
 * page can't read extension storage, so it can't show the right one. It
 * isn't a secret from Gleam's own pages, and it unlocks nothing.
 */
export interface SecurityPhrase {
  word: string;
}

export const SECURITY_PHRASE_WORD_MAX_LENGTH = 24;

const WORD_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u;

const SUGGESTED_WORDS = [
  "amber", "anchor", "aurora", "basalt", "breeze", "cedar", "comet", "coral",
  "delta", "ember", "fjord", "garnet", "harbor", "indigo", "juniper", "kestrel",
  "lagoon", "maple", "meadow", "nectar", "orbit", "pebble", "quartz", "river",
  "saffron", "summit", "tundra", "velvet", "willow", "zephyr",
] as const;

/** The phrase in `value` with its word trimmed, or `null` if it isn't a valid one. */
export function readSecurityPhrase(value: unknown): SecurityPhrase | null {
  if (value === null || typeof value !== "object") return null;
  const { word } = value as { word?: unknown };
  if (typeof word !== "string") return null;
  const trimmed = word.trim();
  if (trimmed.length === 0 || trimmed.length > SECURITY_PHRASE_WORD_MAX_LENGTH || !WORD_PATTERN.test(trimmed)) {
    return null;
  }
  return { word: trimmed };
}

/**
 * The seed the phrase's icon is drawn from. Case and Unicode form are
 * folded so "Willow" and "willow" draw the same icon.
 */
export function securityPhraseSeed(word: string): string {
  return word.trim().normalize("NFC").toLowerCase();
}

/** A random starting choice, so onboarding can move on in one tap. */
export function suggestSecurityPhrase(random: () => number = Math.random, current?: string): SecurityPhrase {
  const choices = SUGGESTED_WORDS.filter((word) => word !== current);
  return { word: choices[Math.floor(random() * choices.length)]! };
}
