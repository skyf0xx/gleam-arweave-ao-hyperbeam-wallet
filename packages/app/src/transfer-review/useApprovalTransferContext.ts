import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DisplayCurrency, DisplaySettings, RuntimePort, TokenPrice } from "@gleam/core";
import { DEFAULT_AO_TOKEN } from "@gleam/ui";
import { DISPLAY_SETTINGS_QUERY_KEY } from "../display-settings";
import { balancesQuery } from "../screens/activity";
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
  runtime: RuntimePort | null,
  address: string | null,
  tokens: Array<string | null>,
): TransferContext {
  const active = runtime !== null && address !== null && tokens.length > 0;
  const tokensKey = [...new Set(tokens.map((token) => token ?? ""))].sort().join(",");

  const settingsQuery = useQuery({
    enabled: active,
    queryKey: DISPLAY_SETTINGS_QUERY_KEY,
    queryFn: () => (runtime as RuntimePort).send<void, DisplaySettings>({ type: "getDisplaySettings", payload: undefined }),
    staleTime: Infinity,
  });
  const settings = settingsQuery.data;

  const balancesRead = useQuery({
    enabled: active,
    queryKey: balancesQuery(runtime as RuntimePort, address ?? "").queryKey,
    queryFn: () => balancesQuery(runtime as RuntimePort, address as string).queryFn(),
  });
  const balances = balancesRead.data;

  const currency: DisplayCurrency | undefined = settings?.currency;
  const watched = (balances?.tokenBalances ?? [])
    .filter((balance) => balance.source !== "discovered" && balance.available !== false)
    .map((balance) => balance.processId)
    .filter((processId) => processId !== DEFAULT_AO_TOKEN.processId && tokensKey.split(",").includes(processId))
    .sort();

  const registryPrices = useQuery({
    enabled: active && currency !== undefined,
    queryKey: ["tokenPrices", currency] as const,
    queryFn: () =>
      (runtime as RuntimePort).send<{ currency: DisplayCurrency }, TokenPrice[]>({
        type: "getTokenPrices",
        payload: { currency: currency as DisplayCurrency },
      }),
  });
  const orderbookPrices = useQuery({
    enabled: active && currency !== undefined && watched.length > 0,
    queryKey: ["orderbookPrices", currency, watched] as const,
    queryFn: async () => {
      const found = await (runtime as RuntimePort).send<{ currency: DisplayCurrency; processIds: string[] }, TokenPrice[]>({
        type: "getTokenPrices",
        payload: { currency: currency as DisplayCurrency, processIds: watched },
      });
      return found.filter((entry) => entry.processId !== null && watched.includes(entry.processId));
    },
  });

  // Undefined until every price read has settled, so a row never flips from AR-only to priced.
  const settled = currency !== undefined && !registryPrices.isPending && (watched.length === 0 || !orderbookPrices.isPending);
  const prices = settled ? [...(registryPrices.data ?? []), ...(orderbookPrices.data ?? [])] : undefined;

  const visibility = useMemo(() => (address ? readRowVisibility(address) : {}), [address]);

  return {
    address: address ?? undefined,
    balances,
    prices,
    currency,
    tokenLogos: settings?.tokenLogos ?? true,
    balancesHidden: settings?.balancesHidden ?? false,
    visibility,
  };
}
