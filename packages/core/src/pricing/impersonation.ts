import { DEFAULT_TOKEN_REGISTRY } from "./token-sources";

/**
 * Whether a token found on-chain (not added by the user) presents itself
 * as a registered token. A process's ticker and name are whatever its
 * spawner wrote, so a stranger's "AO", "A0", "wAR" or "АО" (Cyrillic) is
 * an impersonation, not AO.
 */
// Code points that render as nothing: soft hyphen, joiners, direction marks, BOM.
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0xad, 0xad],
  [0x34f, 0x34f],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x206a, 0x206f],
  [0xfeff, 0xfeff],
];

function isInvisible(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to);
}
const COMBINING = /\p{M}/gu;

// Latin, digit and Cyrillic/Greek lookalikes folded onto one letter.
const LOOKALIKES: Record<string, string> = {
  "0": "o",
  "1": "l",
  i: "l",
  "|": "l",
  "!": "l",
  "а": "a",
  "о": "o",
  "р": "p",
  "е": "e",
  "с": "c",
  "α": "a",
  "ο": "o",
  "ρ": "p",
};

/** A wrapped or bridged form of a registered token (wAR, wAO). */
const WRAPPED_PREFIX = /^w(?=..)/;

export function normalizeTokenLabel(label: string): string {
  const folded = label
    .normalize("NFKC")
    .split("")
    .filter((char) => !isInvisible(char))
    .join("")
    .normalize("NFD")
    .replace(COMBINING, "")
    .toLowerCase()
    .split("")
    .map((char) => LOOKALIKES[char] ?? char)
    .join("");
  return folded.replace(/[^a-z0-9]/g, "");
}

const PROTECTED = new Set(
  DEFAULT_TOKEN_REGISTRY.flatMap((token) => [token.ticker, token.name]).map(normalizeTokenLabel),
);

export function impersonatesRegisteredToken(token: { ticker: string | null; name: string | null }): boolean {
  return [token.ticker, token.name].some((label) => {
    if (label === null) return false;
    const normalized = normalizeTokenLabel(label);
    return PROTECTED.has(normalized) || PROTECTED.has(normalized.replace(WRAPPED_PREFIX, ""));
  });
}
