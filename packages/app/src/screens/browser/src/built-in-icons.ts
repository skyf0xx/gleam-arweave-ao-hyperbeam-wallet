import aoIcon from "../icons/ao.svg?url";
import bazarIcon from "../icons/bazar.svg?url";
import iwashereIcon from "../icons/iwashere.svg?url";
import permatellIcon from "../icons/permatell.svg?url";

/**
 * The built-in dApps' own icons, shipped with the app so the start screen
 * draws them without asking the sites. Keyed by the entry in `BUILT_IN_SITES`.
 */
export const BUILT_IN_ICONS: Readonly<Record<string, string>> = {
  "https://ao.arweave.net/": aoIcon,
  "https://bazar.arweave.net/": bazarIcon,
  "https://iwashere.ar.io/": iwashereIcon,
  "https://www.permatell.xyz/": permatellIcon,
};

/**
 * Single-colour icons, drawn as a mask in the theme's foreground: an
 * `<img>` follows the device's colour scheme even when the app's theme
 * differs.
 */
const MONO_ICONS: ReadonlySet<string> = new Set([aoIcon, bazarIcon, iwashereIcon]);

export const isMonoIcon = (src: string): boolean => MONO_ICONS.has(src);
