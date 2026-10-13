import type { Grant } from "./grant";
import type { PermissionType } from "./permission";

/** `ActiveSite.otherWallet` for a wallet whose reported name Gleam doesn't recognise. */
export const UNKNOWN_WALLET_NAME = "another wallet";

/**
 * What Gleam knows about the site in the active tab. When another wallet
 * extension is installed, the page's `window.arweaveWallet` forwards to
 * that wallet unless `usesGleam`.
 */
export interface ActiveSite {
  origin: string;
  /** The tab's favicon, when it's an https or inline image URL. */
  favIconUrl: string | null;
  /** The other wallet on the page, by display name, or null when Gleam is the only one. */
  otherWallet: string | null;
  /** When the page last called the other wallet in this tab, or null if it hasn't. */
  otherWalletUsedAt: number | null;
  /** What the page asked the other wallet for, or already holds there. Empty when unknown. */
  otherWalletPermissions: PermissionType[];
  grant: Grant | null;
  /** The user chose Gleam for this site, or it holds a grant from before. */
  usesGleam: boolean;
  /** The user closed the "Use Gleam here" suggestion for this origin. */
  suggestionDismissed: boolean;
}
