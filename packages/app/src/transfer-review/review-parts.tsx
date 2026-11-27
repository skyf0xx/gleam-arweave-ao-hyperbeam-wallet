import { Fragment, type ReactNode } from "react";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { useLocale, useT } from "../i18n";
import { UntrustedText } from "../approval/UntrustedText";
import {
  feeFiatText,
  feeText,
  isUnknownScale,
  unitText,
  type BalanceAfterPart,
  type SignedPart,
  type TransferContext,
  type TransferLine,
} from "./model";

export const GUTTER = "px-6 phone:px-5";

/** The signed tags the headline didn't read, counted where the amount is; Details lists them. */
export function OtherTags({ transfer }: { transfer: TransferLine }) {
  const t = useT();
  if (!transfer.otherTags) return null;
  return <span className="text-label font-medium text-foreground">{t("transferReview.otherTags", { count: transfer.otherTags })}</span>;
}

/** An AR transfer can also carry data, which is signed with it, so its size sits beside the amount. */
export function DataRow({ transfer }: { transfer: TransferLine & { part: SignedPart } }) {
  const t = useT();
  const size = transfer.part.dataSize ?? 0;
  if (transfer.token !== null || size <= 0) return null;
  return <SummaryRow label={t("approval.data")} value={t("approval.bytes", { size: String(size) })} />;
}

export function FeeValue({ fee, context }: { fee: string | null; context: TransferContext }) {
  const t = useT();
  const locale = useLocale();
  const fiat = feeFiatText(fee, context);
  return (
    <>
      {feeText(fee, t, locale)}
      {fiat ? <span className="ml-1.5 text-muted">{fiat}</span> : null}
    </>
  );
}

export function FromValue({ from }: { from: { name: string | null; address: string } }) {
  return (
    <span className="min-w-0 break-words text-body font-medium text-foreground">
      {from.name ? <>{from.name} </> : null}
      <span dir="ltr" className="font-mono text-caption font-normal text-muted">
        {truncateAddress(from.address, 4)}
      </span>
    </span>
  );
}

export function TokenValue({ transfer }: { transfer: TransferLine }) {
  const t = useT();
  if (transfer.token === null) return <>AR</>;
  if (transfer.collectible || isUnknownScale(transfer) || transfer.impersonating) {
    return (
      <span dir="ltr" className="block max-w-[13.5rem] break-all text-right font-mono text-label leading-snug text-foreground">
        {transfer.collectible && !transfer.impersonating ? truncateAddress(transfer.token, 6) : transfer.token}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-medium"><UntrustedText text={unitText(transfer, t)} /></span>
      <span dir="ltr" className="font-mono text-caption text-muted">
        {truncateAddress(transfer.token, 6)}
      </span>
    </span>
  );
}

export function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-4 text-body">
      <span className="flex-shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function BalanceAfter({ parts }: { parts: BalanceAfterPart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? " · " : null}
          {part.amount}
          {part.ticker !== null ? <> <UntrustedText text={part.ticker} /></> : null}
        </Fragment>
      ))}
    </>
  );
}
