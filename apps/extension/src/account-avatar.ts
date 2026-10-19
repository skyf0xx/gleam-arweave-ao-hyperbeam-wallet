import { Avatar, Style } from "@dicebear/core";
import shapes from "@dicebear/styles/shapes.json";
import { securityPhraseSeed } from "@gleam/core";

const shapesStyle = new Style(shapes);

/**
 * Beam Sky and Beam Yellow, each with its complement (coral, lavender),
 * plus a mint and a rose for range. All six sit at about the same
 * lightness and strength, so no one colour dominates a tile the way Beam
 * Purple did, and none is a warning red. The ground is left transparent
 * so `AccountAvatar` sets it on the theme's own background.
 */
const SHAPE_COLORS = ["#73c9e8", "#ff9c8b", "#ffe45c", "#bdafff", "#7cd591", "#f59cd8"];
const TRANSPARENT = ["#00000000"];

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
  return new Avatar(shapesStyle, {
    seed: securityPhraseWord === null ? address : `${securityPhraseSeed(securityPhraseWord)}:${address}`,
    backgroundColor: TRANSPARENT,
    shape1Color: SHAPE_COLORS,
    shape2Color: SHAPE_COLORS,
    shape3Color: SHAPE_COLORS,
  }).toString();
}
