import { useMemo } from "react";
import type { DisplayCurrency, RuntimePort } from "@gleam/core";
import { DEFAULT_AO_TOKEN } from "@gleam/ui";
import { useDisplaySettings } from "../display-settings";
import { useBalances } from "../screens/activity";
import { useOrderbookPrices, useTokenPrices } from "../screens/main-screen/src/useTokenPrices";
import { readRowVisibility } from "../token-visibility";
import type { TransferContext } from "./model";

/**
 * Balances, prices and display settings for an approval's transfer, read
 * once when it opens, through the same queries the main screen uses. Every
 * read is best effort: a failed one only hides the fiat line, the logo or
 * the balance after.
 *
 * Only a token the wallet added by hand is priced from its orderbook, as
 * on the main screen; any other token's price would be its creator's claim.
 */
export function useApprovalTransferContext(
  runtime: RuntimePort,
  address: string | null,
  tokens: Array<string | null>,
): TransferContext {
  const active = address !== null && tokens.length > 0;
  const tokensKey = [...new Set(tokens.map((token) => token ?? ""))].sort().join(",");

  const { settings: displaySettings } = useDisplaySettings(runtime, active);
  const balances = useBalances(runtime, address ?? "", active).data;

  const currency: DisplayCurrency | undefined = displaySettings?.currency;
  const watched = (balances?.tokenBalances ?? [])
    .filter((balance) => balance.source !== "discovered" && balance.available !== false)
    .map((balance) => balance.processId)
    .filter((processId) => processId !== DEFAULT_AO_TOKEN.processId && tokensKey.split(",").includes(processId))
    .sort();

  const registryPrices = useTokenPrices(runtime, active ? currency : undefined);
  const orderbookPrices = useOrderbookPrices(runtime, active ? currency : undefined, watched);

  // Undefined until every price read has settled, so a row never flips from AR-only to priced.
  const settled = currency !== undefined && !registryPrices.isPending && (watched.length === 0 || !orderbookPrices.isPending);
  const prices = settled ? [...(registryPrices.data ?? []), ...(orderbookPrices.data ?? [])] : undefined;

  const visibility = useMemo(() => (address ? readRowVisibility(address) : {}), [address]);

  return {
    address: address ?? undefined,
    balances,
    prices,
    currency,
    tokenLogos: displaySettings?.tokenLogos ?? true,
    balancesHidden: displaySettings?.balancesHidden ?? false,
    visibility,
  };
}
