import { Avatar, Style } from "@dicebear/core";
import shapes from "@dicebear/styles/shapes.json";
import { securityPhraseSeed } from "@gleam/core";
import { SECURITY_PHRASE_ICON_COLORS } from "./security-phrase-icon";

const shapesStyle = new Style(shapes);
const colors = [...SECURITY_PHRASE_ICON_COLORS];

/**
 * An address's avatar, drawn locally. `shapes` puts three large shapes on
 * a coloured ground, which tells two addresses apart at 24px better than
 * a pattern does. It shares the security phrase's palette.
 *
 * The seed mixes in the user's security phrase, so someone grinding a
 * lookalike address can't predict the avatar it will get. The phrase is
 * the same on every device the user sets it on, so avatars match across
 * devices; they change once, when the phrase is set or changed.
 */
export function generateAccountAvatarSvg(address: string, securityPhraseWord: string | null): string {
  return new Avatar(shapesStyle, {
    seed: securityPhraseWord === null ? address : `${securityPhraseSeed(securityPhraseWord)}:${address}`,
    backgroundColor: colors,
    shape1Color: colors,
    shape2Color: colors,
    shape3Color: colors,
  }).toString();
}
