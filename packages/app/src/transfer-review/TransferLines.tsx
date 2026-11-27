import { permawebNameLabel } from "@gleam/core";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import {
  AccountAvatar,
  CollectibleThumbnail,
  MemorableAddress,
  TokenGlyph,
} from "@gleam/ui/src/components/wallet/index.ts";
import { useAddressIdentity } from "../address-identity";
import { useLocale, useT } from "../i18n";
import { UntrustedText } from "../approval/UntrustedText";
import { DataRow, GUTTER, OtherTags, SummaryRow, TokenValue } from "./review-parts";
import {
  amountText,
  fiatText,
  glyphLabel,
  groupDigits,
  isUnknownScale,
  logoFor,
  totalFiatText,
  unitText,
  type SignedPart,
  type TransferContext,
  type TransferLine,
  type TransferRequest,
} from "./model";

function Glyph({ transfer, context, size }: { transfer: TransferLine; context: TransferContext; size: "hero" | "card" }) {
  return (
    <TokenGlyph
      label={glyphLabel(transfer)}
      tone={glyphLabel(transfer) === "?" ? 4 : 1}
      logoUrl={logoFor(transfer, context)}
      className={size === "hero" ? "h-11 w-11 rounded-full text-label" : "h-8 w-8 rounded-full text-caption"}
    />
  );
}

export function Hero({ transfer, context }: { transfer: TransferLine; context: TransferContext }) {
  const t = useT();
  const locale = useLocale();
  if (transfer.collectible) {
    const name = transfer.collectible.name ?? truncateAddress(transfer.collectible.id, 6);
    return (
      <div className={`flex flex-col items-center gap-3 pb-8 pt-8 text-center ${GUTTER}`}>
        <CollectibleThumbnail
          name={name}
          imageUrl={transfer.collectible.imageUrl}
          nameLabel={permawebNameLabel(transfer.collectible.name)}
          decorative
          className="w-40 rounded-[14px]"
        />
        <div className="flex flex-col items-center gap-0.5">
          <span className="break-words text-h3 font-semibold text-foreground"><UntrustedText text={name} /></span>
          <span className="text-label text-muted">{t("transferReview.oneItem")}</span>
          <OtherTags transfer={transfer} />
        </div>
      </div>
    );
  }
  const fiat = fiatText(context, transfer);
  return (
    <div className={`flex flex-col items-center gap-2.5 pb-8 pt-9 text-center ${GUTTER}`}>
      <Glyph transfer={transfer} context={context} size="hero" />
      {isUnknownScale(transfer) ? (
        <div className="flex max-w-full flex-col items-center gap-1">
          <span dir="ltr" className="font-mono text-display-sm font-medium leading-tight tracking-[-0.02em] tabular-nums text-foreground [overflow-wrap:anywhere]">
            {amountText(transfer, locale)}
          </span>
          <span className="text-body text-muted"><UntrustedText text={unitText(transfer, t)} /></span>
        </div>
      ) : (
        <div className="flex max-w-full flex-col items-center gap-1">
          <div className="flex max-w-full flex-wrap items-baseline justify-center gap-x-2">
            <span className="text-display-lg font-semibold dark:font-medium leading-[1.1] tracking-[-0.03em] tabular-nums text-foreground [overflow-wrap:anywhere]">
              {amountText(transfer, locale)}
            </span>
            <span className="text-h3 font-semibold text-muted"><UntrustedText text={unitText(transfer, t)} /></span>
          </div>
          {fiat ? <span className="text-body tabular-nums text-muted">{fiat}</span> : null}
        </div>
      )}
      <OtherTags transfer={transfer} />
    </div>
  );
}


export function BatchHero({ request, context }: { request: TransferRequest; context: TransferContext }) {
  const t = useT();
  const total = totalFiatText(context, request.transfers);
  if (total === undefined) return <div className="pt-6" />;
  return (
    <div className={`flex flex-col items-center gap-1 pb-7 pt-8 text-center ${GUTTER}`}>
      <span className="text-display-lg font-semibold dark:font-medium leading-[1.1] tracking-[-0.03em] tabular-nums text-foreground">{total}</span>
      <span className="text-body text-muted">{t("transferReview.totalValue")}</span>
    </div>
  );
}

export function TransferCard({ transfer, context }: { transfer: TransferLine & { part: SignedPart }; context: TransferContext }) {
  const t = useT();
  const locale = useLocale();
  const identity = useAddressIdentity();
  const fiat = fiatText(context, transfer);
  return (
    <div className="flex flex-col gap-3.5 rounded-xl bg-mist p-4">
      <div className="flex items-center gap-3">
        <Glyph transfer={transfer} context={context} size="card" />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
          <span
            dir="ltr"
            className={`font-semibold tracking-[-0.02em] tabular-nums text-foreground [overflow-wrap:anywhere] ${isUnknownScale(transfer) ? "font-mono text-body" : "text-xl"}`}
          >
            {amountText(transfer, locale)}
          </span>
          <span className="text-body font-semibold text-muted"><UntrustedText text={unitText(transfer, t)} /></span>
        </div>
        {fiat ? <span className="flex-shrink-0 text-label tabular-nums text-muted">{fiat}</span> : null}
      </div>
      <OtherTags transfer={transfer} />
      <div className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3">
        <span aria-hidden="true" className="mt-[18px] justify-self-center">
          <AccountAvatar svgMarkup={identity.avatarSvg(transfer.recipient)} label="" size={24} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label text-muted">{t("transferReview.to")}</span>
          <MemorableAddress address={transfer.recipient} emphasisPick={identity.emphasisPick} tone="confirm" />
        </div>
      </div>
      {/* The ticker and scale come from untrusted metadata, so the process
          and raw units sit on the card, not only behind Details. */}
      {transfer.token !== null ? (
        <div className="flex flex-col gap-1.5">
          <SummaryRow label={t("transferReview.token")} value={<TokenValue transfer={transfer} />} />
          {transfer.collectible || isUnknownScale(transfer) ? null : (
            <SummaryRow
              label={t("transferReview.rawUnitsLabel")}
              value={
                <span dir="ltr" className="font-mono text-caption">
                  {groupDigits(transfer.amount)}
                </span>
              }
            />
          )}
        </div>
      ) : (
        <DataRow transfer={transfer} />
      )}
    </div>
  );
}
