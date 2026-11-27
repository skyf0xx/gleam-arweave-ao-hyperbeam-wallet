import type { UseQueryResult } from "@tanstack/react-query";
import type { TransferFeeQuote } from "@gleam/core";
import { useLocale, useT } from "../../../i18n";
import { feeText } from "../../../transfer-review/model";

/**
 * The fee on compose, fetched while the user types. A failed quote shows
 * nothing here: Continue fetches it again and shows the error.
 */
export function NetworkFeeLine({ quote, fiat }: { quote: UseQueryResult<TransferFeeQuote>; fiat?: string }) {
  const t = useT();
  const locale = useLocale();
  if (quote.isError) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 text-label">
      <span className="text-muted">{t("transferReview.networkFee")}</span>
      {quote.data === undefined ? (
        <span className="text-muted">{t("send.estimatingFee")}</span>
      ) : (
        <span className="tabular-nums text-foreground">
          {feeText(quote.data.fee, t, locale)}
          {fiat !== undefined ? <span className="ml-1.5 text-muted">{fiat}</span> : null}
        </span>
      )}
    </div>
  );
}
