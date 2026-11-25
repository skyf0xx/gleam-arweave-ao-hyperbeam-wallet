import { useQuery } from "@tanstack/react-query";
import type { RuntimePort } from "@gleam/core";
import { walletStateQuery } from "./useWalletState";

/**
 * The vault's other wallets (every stored wallet except `excludeWalletId`)
 * — feeds Send's saved-addresses screen "Your wallets" section, so sending
 * between your own wallets is as easy as picking a saved contact. Reuses
 * `getState`, the same call `WalletSwitcherView` already makes, rather
 * than inventing a wallets-only endpoint. The query refetches when the
 * window regains focus or the network returns, which isn't the user
 * using the wallet, so it doesn't push back auto-lock.
 */
export function useOtherWallets(runtime: RuntimePort, excludeWalletId: string) {
  return useQuery({
    ...walletStateQuery(runtime),
    select: (state) => state.wallets.filter((wallet) => wallet.id !== excludeWalletId),
  });
}
