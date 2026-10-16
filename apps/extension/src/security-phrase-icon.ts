import { Avatar, Style } from "@dicebear/core";
import gaze from "@dicebear/styles/gaze.json";
import { securityPhraseSeed } from "@gleam/core";

/**
 * The beam's colours without Beam Red, plus the hues between them. Red
 * is left out because a red face beside a security check reads as a
 * warning. This is the one place the beam palette is loosened: the icon
 * is the user's own, so it should feel personal.
 */
export const SECURITY_PHRASE_ICON_COLORS = [
  "#8b12ff", // beam purple
  "#73c9e8", // beam sky
  "#ffe45c", // beam yellow
  "#28f02d", // beam green
  "#ff4fd8", // magenta, red → purple
  "#4a5cff", // ultramarine, purple → sky
  "#2ee6c1", // aqua, sky → green
  "#b8f23a", // lime, green → yellow
  "#b98cff", // lavender, a purple tint
] as const;

const gazeStyle = new Style(gaze);

/**
 * The phrase's icon, drawn locally from the word. It is the same for the
 * same word everywhere, so the user learns to recognise it.
 */
export function securityPhraseIconSvg(word: string): string {
  return new Avatar(gazeStyle, { seed: securityPhraseSeed(word), bodyColor: [...SECURITY_PHRASE_ICON_COLORS] }).toString();
}
