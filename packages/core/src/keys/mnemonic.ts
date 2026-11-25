import { BIP39_ENGLISH } from "./bip39-wordlist";
import { sha256 } from "../models/bytes";

/**
 * BIP-39 recovery phrases, English wordlist only, as Wander and
 * arweave.app create them. Gleam only imports phrases: it never generates
 * or stores one. Everything here is WebCrypto, so the derivation can't
 * drift with a dependency; `mnemonic.keys.test.ts` checks it against the
 * BIP-39 reference vectors.
 */

export const MNEMONIC_WORD_COUNTS = [12, 15, 18, 21, 24] as const;

const WORD_INDEX: ReadonlyMap<string, number> = new Map(BIP39_ENGLISH.map((word, index) => [word, index]));

/** True when `word` is on the BIP-39 English wordlist. */
export function isMnemonicWord(word: string): boolean {
  return WORD_INDEX.has(word);
}

/** Wordlist words starting with `prefix`, in list order, at most `limit`. */
export function suggestMnemonicWords(prefix: string, limit = 4): string[] {
  const needle = prefix.trim().toLowerCase();
  if (needle.length === 0) return [];
  const matches: string[] = [];
  for (const word of BIP39_ENGLISH) {
    if (word.startsWith(needle)) {
      matches.push(word);
      if (matches.length === limit) break;
    }
  }
  return matches;
}

/**
 * Splits pasted or typed text into lowercase words. Phrases come out of
 * notes apps and password managers as `1. word 2. word`, one per line,
 * comma-separated or with non-breaking spaces, so any run of whitespace,
 * commas or semicolons separates words and a leading number such as
 * `1.`, `1)` or `#1` is dropped.
 */
export function splitPhrase(raw: string): string[] {
  return raw
    .normalize("NFKD")
    .toLowerCase()
    .split(/[\s,;]+/u)
    .map((token) => token.replace(/^[#(]?\d+[.):-]*/u, ""))
    .filter((token) => token.length > 0);
}

export type MnemonicProblem =
  | { kind: "wordCount"; count: number }
  | { kind: "unknownWords"; positions: number[] }
  | { kind: "checksum" };

export type MnemonicCheck = { valid: true } | { valid: false; problem: MnemonicProblem };

/**
 * Checks length, wordlist membership and the BIP-39 checksum. Wander's own
 * check skips the checksum; Gleam enforces it, because a mistyped word that
 * is still on the list would otherwise import a different, empty wallet.
 * `positions` are zero-based.
 */
export async function checkMnemonic(words: readonly string[]): Promise<MnemonicCheck> {
  const unknown = words.flatMap((word, position) => (WORD_INDEX.has(word) ? [] : [position]));
  if (unknown.length > 0) return { valid: false, problem: { kind: "unknownWords", positions: unknown } };

  if (!(MNEMONIC_WORD_COUNTS as readonly number[]).includes(words.length)) {
    return { valid: false, problem: { kind: "wordCount", count: words.length } };
  }

  // Each word is 11 bits. The first 32/33 of them are entropy, the rest
  // the leading bits of SHA-256(entropy).
  const totalBits = words.length * 11;
  const checksumBits = totalBits / 33;
  const entropyBytes = (totalBits - checksumBits) / 8;

  const bits = new Uint8Array(totalBits);
  words.forEach((word, position) => {
    const index = WORD_INDEX.get(word)!;
    for (let bit = 0; bit < 11; bit++) bits[position * 11 + bit] = (index >> (10 - bit)) & 1;
  });

  const entropy = new Uint8Array(entropyBytes);
  for (let i = 0; i < entropyBytes * 8; i++) entropy[i >> 3]! |= bits[i]! << (7 - (i & 7));

  const digest = await sha256(entropy);
  entropy.fill(0);
  let matches = true;
  for (let i = 0; i < checksumBits; i++) {
    const expected = (digest[i >> 3]! >> (7 - (i & 7))) & 1;
    if (expected !== bits[entropyBytes * 8 + i]) matches = false;
  }
  bits.fill(0);
  return matches ? { valid: true } : { valid: false, problem: { kind: "checksum" } };
}

/**
 * BIP-39 seed: PBKDF2-HMAC-SHA512 over the space-joined words, salt
 * `"mnemonic"` (no passphrase, as Wander uses none), 2048 rounds, 64 bytes.
 * The caller owns the returned bytes and should zero them when done.
 */
export async function mnemonicToSeed(words: readonly string[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const password = encoder.encode(words.join(" ").normalize("NFKD"));
  try {
    const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-512", salt: encoder.encode("mnemonic"), iterations: 2048 },
      key,
      512,
    );
    return new Uint8Array(bits);
  } finally {
    password.fill(0);
  }
}
