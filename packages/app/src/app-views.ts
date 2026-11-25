import type { Collectible, PermissionType, TokenBalance, WalletState, WalletSummary } from "@gleam/core";

export type TopView = "loading" | "onboarding" | "unlock" | "main-screen";
export type MainSubView =
  /** `editTokens` reopens the token list in edit mode, where add-token was opened from. */
  | { kind: "home"; editTokens?: boolean }
  /** `token: null` is the AR path (the top-level Send action); an AO token row's click carries its `TokenBalance`. */
  | { kind: "send"; token: TokenBalance | null; recipient?: string }
  | { kind: "receive" }
  | { kind: "wallet-switcher" }
  | { kind: "wallet-detail"; walletId: string }
  | { kind: "add-wallet" }
  | { kind: "settings-home" }
  | { kind: "appearance" }
  | { kind: "lock-settings" }
  | { kind: "backup" }
  | { kind: "network-peers" }
  /** `linkId` is set for a page a browse link opened, so a second link reopens the screen on its page. */
  | { kind: "browser"; url?: string; linkId?: number }
  /** `origin` is the site whose entry to show; `returnToUrl` is the browser page to go back to. */
  | { kind: "connected-apps"; origin?: string; returnToUrl?: string }
  | { kind: "manage-tokens" }
  | { kind: "display-currency" }
  | { kind: "home-screen" }
  | { kind: "language" }
  | { kind: "collectible"; collectible: Collectible }
  | { kind: "send-collectible"; collectible: Collectible }
  | { kind: "name-target"; collectible: Collectible; target: string }
  | { kind: "points" }
  | { kind: "use-gleam-on-site"; origin: string; favIconUrl: string | null; requestedPermissions: PermissionType[] };

export function resolveTopView(state: WalletState): TopView {
  if (state.wallets.length === 0) return "onboarding";
  if (state.session === null || state.session.unlockedWalletIds.length === 0) return "unlock";
  return "main-screen";
}

export function resolveActiveWallet(state: WalletState): WalletSummary | null {
  const unlockedId = state.session?.unlockedWalletIds[0] ?? null;
  const preferredId = state.activeWalletId ?? unlockedId;
  return state.wallets.find((wallet) => wallet.id === preferredId) ?? state.wallets[0] ?? null;
}
