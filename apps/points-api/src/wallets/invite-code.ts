import { randomInt } from "node:crypto";

// Omits 0/O and 1/I/L, which get confused when a code is typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

export function randomCodeSuffix(length: number): string {
  let suffix = "";
  for (let i = 0; i < length; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return suffix;
}

export function randomInviteCode(): string {
  return randomCodeSuffix(LENGTH);
}
