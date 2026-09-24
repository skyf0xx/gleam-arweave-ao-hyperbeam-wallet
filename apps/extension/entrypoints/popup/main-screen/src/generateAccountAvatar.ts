import { Avatar, Style } from "@dicebear/core";
import waves from "@dicebear/styles/waves.json"

/**
 * Generates the account pill's identity avatar SVG entirely in-process via
 * `@dicebear/core` + `@dicebear/styles`'s bundled `weave` style JSON —
 * no `fetch`/network call to `api.dicebear.com` or any other host, ever.
 *
 * `weave` (a geometric, faceless pattern keyed by seed) was chosen
 * over dicebear's avatar-shaped styles (`avataaars`, `micah`, etc.) since
 * a wallet address has no identity to depict a face for — the same
 * reasoning ArConnect/MetaMask-style wallets use their own geometric
 * per-address glyphs for. `address` is passed directly as the `seed`, so
 * the same address always renders the same avatar and two different
 * wallets render visibly different ones.
 *
 * The `Style` instance is constructed once at module scope, per
 * `@dicebear/core`'s own `Style` doc comment ("reuse the instance across
 * avatars"), rather than per call.
 */
const waveStyle = new Style(waves);

export function generateAccountAvatarSvg(address: string): string {
  const avatar = new Avatar(waveStyle, { seed: address });
  return avatar.toString();
}
