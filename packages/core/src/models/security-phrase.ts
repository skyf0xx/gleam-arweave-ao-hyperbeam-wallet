/**
 * An emoji and a word the user picks, shown on Gleam's unlock and
 * approval screens. A fake Gleam window drawn inside a web page can't
 * read extension storage, so it can't show the right one. It isn't a
 * secret from Gleam's own pages, and it unlocks nothing.
 */
export interface SecurityPhrase {
  emoji: string;
  word: string;
}

/** A fixed set, so every choice renders the same everywhere and can be checked exactly. */
export const SECURITY_PHRASE_EMOJI = [
  "🦊", "🐙", "🦉", "🐢", "🦋", "🐝", "🦀", "🐳",
  "🌵", "🍄", "🌻", "🍁", "🌙", "⭐", "🔥", "🌊",
  "🍋", "🍒", "🥑", "🎈", "🎲", "🔑", "⚓", "🚲",
] as const;

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
  const { emoji, word } = value as { emoji?: unknown; word?: unknown };
  if (typeof emoji !== "string" || !(SECURITY_PHRASE_EMOJI as readonly string[]).includes(emoji)) return null;
  if (typeof word !== "string") return null;
  const trimmed = word.trim();
  if (trimmed.length === 0 || trimmed.length > SECURITY_PHRASE_WORD_MAX_LENGTH || !WORD_PATTERN.test(trimmed)) {
    return null;
  }
  return { emoji, word: trimmed };
}

/** A random starting choice, so onboarding can move on in one tap. */
export function suggestSecurityPhrase(random: () => number = Math.random): SecurityPhrase {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  return { emoji: pick(SECURITY_PHRASE_EMOJI), word: pick(SUGGESTED_WORDS) };
}
