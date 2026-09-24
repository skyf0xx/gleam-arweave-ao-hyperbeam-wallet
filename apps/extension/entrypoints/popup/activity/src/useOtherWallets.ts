import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, WalletState } from "@gleam/core";

/**
 * The vault's other wallets (every stored wallet except `excludeWalletId`)
 * — feeds Send's saved-addresses screen "Your wallets" section, so sending
 * between your own wallets is as easy as picking a saved contact. Reuses
 * `getState`, the same call `WalletSwitcherView` already makes, rather
 * than inventing a wallets-only endpoint.
 */
export function useOtherWallets(runtime: RuntimePort, excludeWalletId: string) {
  return useQuery({
    queryKey: ["wallets", "state"],
    queryFn: () => runtime.send<void, WalletState>({ type: "getState", payload: undefined }),
    select: (state) => state.wallets.filter((wallet) => wallet.id !== excludeWalletId),
  });
}
