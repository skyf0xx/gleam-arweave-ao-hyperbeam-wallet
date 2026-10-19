import { Avatar, Style } from "@dicebear/core";
import shapes from "@dicebear/styles/shapes.json";
import { SECURITY_PHRASE_ICON_COLORS } from "./security-phrase-icon";

const shapesStyle = new Style(shapes);
const colors = [...SECURITY_PHRASE_ICON_COLORS];

/**
 * An address's avatar, drawn locally and seeded by the address itself, so
 * a wallet shows the same one everywhere. `shapes` puts three large shapes
 * on a coloured ground, which tells two addresses apart at 24px better
 * than a pattern does. It shares the security phrase's palette.
 */
export function generateAccountAvatarSvg(address: string): string {
  return new Avatar(shapesStyle, {
    seed: address,
    backgroundColor: colors,
    shape1Color: colors,
    shape2Color: colors,
    shape3Color: colors,
  }).toString();
}
