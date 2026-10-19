import { Avatar, Style } from "@dicebear/core";
import shapes from "@dicebear/styles/shapes.json";
import { securityPhraseSeed } from "@gleam/core";

const shapesStyle = new Style(shapes);

/**
 * Each avatar is painted in one colour family: a pale tile and three
 * shades of the same hue. One hue per tile keeps every avatar calm and
 * whole; the variety comes across a list, where the families together
 * echo the beam. The shades are matched in lightness across families, so
 * no family reads heavier than another.
 */
const FAMILIES = [
  { tile: "#efebff", shapes: ["#765bb6", "#9c82e2", "#ccbbff"] }, // violet
  { tile: "#e4efff", shapes: ["#3f6bbf", "#6593eb", "#a4c8ff"] }, // blue
  { tile: "#daf3fe", shapes: ["#007dab", "#00a6d5", "#7ad5f8"] }, // sky
  { tile: "#d9f5f3", shapes: ["#008781", "#00afa8", "#71dcd6"] }, // teal
  { tile: "#e1f5e4", shapes: ["#17843f", "#4aad65", "#98daa5"] }, // green
  { tile: "#f9edd9", shapes: ["#b27a00", "#dfa635", "#eac07a"] }, // amber
  { tile: "#ffe8e1", shapes: ["#b14a31", "#dd7257", "#ffb09b"] }, // coral
  { tile: "#ffe7f1", shapes: ["#a8477a", "#d46ea1", "#f9add0"] }, // rose
] as const;

/** FNV-1a: a cheap, stable hash to pick the family from the same seed dicebear draws from. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * An address's avatar, drawn locally. `shapes` sets three large shapes,
 * which tells two addresses apart at 24px better than a pattern does.
 *
 * The seed mixes in the user's security phrase, so someone grinding a
 * lookalike address can't predict the avatar it will get. The phrase is
 * the same on every device the user sets it on, so avatars match across
 * devices; they change once, when the phrase is set or changed.
 */
export function generateAccountAvatarSvg(address: string, securityPhraseWord: string | null): string {
  const seed = securityPhraseWord === null ? address : `${securityPhraseSeed(securityPhraseWord)}:${address}`;
  const family = FAMILIES[hashSeed(seed) % FAMILIES.length]!;
  return new Avatar(shapesStyle, {
    seed,
    backgroundColor: [family.tile],
    shape1Color: [...family.shapes],
    shape2Color: [...family.shapes],
    shape3Color: [...family.shapes],
  }).toString();
}
