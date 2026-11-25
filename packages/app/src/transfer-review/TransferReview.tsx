import type { ReactNode } from "react";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import {
  AccountAvatar,
  MemorableAddress,
  RecipientWarning,
} from "@gleam/ui/src/components/wallet/index.ts";
import { useAddressIdentity } from "../address-identity";
import { useT } from "../i18n";
import { UntrustedText } from "../approval/UntrustedText";
import { ArmingLabel } from "../approval/ArmingLabel";
import { DataItemCard } from "./DataItemCard";
import { ReviewDetails } from "./ReviewDetails";
import { BatchHero, Hero, TransferCard } from "./TransferLines";
import { BalanceAfter, FeeValue, FromValue, GUTTER, SummaryRow, TokenValue, DataRow } from "./review-parts";
import {
  balanceAfterParts,
  showsRisk,
  showsWarning,
  warningReasons,
  type RecipientRisk,
  type TransferContext,
  type TransferRequest,
} from "./model";

export interface TransferReviewProps {
  /** `RequestHeader` in an approval, the screen's own back header on Send. */
  header: ReactNode;
  /** Above the hero, such as the hardware wallet's "Confirm on your device" strip. */
  banner?: ReactNode;
  request: TransferRequest;
  /** The signing wallet. */
  from: { name: string | null; address: string } | null;
  /** A saved contact's or own wallet's name for the recipient. */
  toName?: string | null;
  context: TransferContext;
  /** `null` once the recipient has been accepted, as on a device step. */
  risk: RecipientRisk | null;
  /** Errors, status lines or a device panel, between the summary and the buttons. */
  children?: ReactNode;
  /** Gets whether the warning box shows, which makes the primary action destructive. */
  footer: (warned: boolean) => ReactNode;
}

/**
 * Every value-moving request in one layout and one order: who asks, the
 * amount, from and to, the token, fee and balance after, then the raw
 * details. Addresses are shown in full; the token is named by its id
 * as well as its self-chosen ticker. The warning box shows for a
 * first-time or lookalike recipient, for a token with no stated scale and
 * for a token transfer the wallet couldn't read, and only then is the
 * primary action red. That last case opens Details and the tags, since
 * the tags are what the token acts on.
 */
export function TransferReview({
  header,
  banner,
  request,
  from,
  toName,
  context,
  risk,
  children,
  footer,
}: TransferReviewProps) {
  const t = useT();
  const identity = useAddressIdentity();
  const noticed = showsWarning(request, risk);
  const warned = showsRisk(request, risk);
  const batch = request.transfers.length > 1 || request.others.length > 0;
  const first = request.transfers[0]!;
  const balanceAfter = balanceAfterParts(context, request);
  const lookalikeOf = risk?.lookalikeOf ?? null;

  const warning = noticed ? (
    <div className={`${GUTTER} pt-4`}>
      <RecipientWarning
        firstTime={risk?.firstTime ?? false}
        recipient={risk?.lookalikeRecipient ?? first.recipient}
        tone={warned ? "risk" : "caution"}
        lookalikeOf={lookalikeOf}
        lookalikeAvatarSvg={lookalikeOf ? identity.avatarSvg(lookalikeOf) : undefined}
        emphasisPick={identity.emphasisPick}
        extraReasons={warningReasons(request, t)}
      />
    </div>
  ) : null;

  return (
    <div className="flex min-h-full flex-col">
      {header}
      {banner ? <div className={`${GUTTER} pt-5`}>{banner}</div> : null}

      {batch ? (
        <>
          <BatchHero request={request} context={context} />
          <div className={`flex flex-col gap-3 ${GUTTER}`}>
            {/* Signing order, so a card's position matches its item number in Details. */}
            {[
              ...request.transfers.map((transfer) => ({
                index: transfer.index,
                node: <TransferCard key={`t${transfer.index}`} transfer={transfer} context={context} />,
              })),
              ...request.others.map((item) => ({
                index: item.index,
                node: <DataItemCard key={`d${item.index}`} index={item.index} item={item} numbered walletAddress={from?.address ?? null} />,
              })),
            ]
              .sort((a, b) => a.index - b.index)
              .map((entry) => entry.node)}
          </div>
          {warning}
          <div className={`flex flex-col gap-3.5 pt-6 ${GUTTER}`}>
            {from ? <SummaryRow label={t("transferReview.from")} value={<FromValue from={from} />} /> : null}
            <SummaryRow label={t("transferReview.networkFee")} value={<FeeValue fee={request.fee} context={context} />} />
            {balanceAfter !== undefined ? <SummaryRow label={t("transferReview.balanceAfter")} value={<BalanceAfter parts={balanceAfter} />} /> : null}
          </div>
        </>
      ) : (
        <>
          <Hero transfer={first} context={context} />
          {from ? <FromParty from={from} /> : null}
          {/* In silica, a lens runs from the recipient down through the summary. */}
          <div className="gleam-lens-down silica:pt-3.5 silica:pb-6">
            <ToParty to={first.recipient} toName={toName ?? null} diffAgainst={lookalikeOf ?? undefined} />
            {warning}
            <div className={`flex flex-col gap-3.5 pt-8 ${GUTTER}`}>
              <SummaryRow label={t("transferReview.token")} value={<TokenValue transfer={first} />} />
              <DataRow transfer={first} />
              <SummaryRow label={t("transferReview.networkFee")} value={<FeeValue fee={request.fee} context={context} />} />
              {balanceAfter !== undefined ? <SummaryRow label={t("transferReview.balanceAfter")} value={<BalanceAfter parts={balanceAfter} />} /> : null}
            </div>
          </div>
        </>
      )}

      <ReviewDetails request={request} batch={batch} />

      {children ? <div className={`flex flex-col gap-3 pt-5 ${GUTTER}`}>{children}</div> : null}

      {footer(warned)}
    </div>
  );
}

/**
 * A Permaweb Name change: `@name`, then the id it will point to, then who
 * signs and the fee (the reward plus the 1 winston the set carries). The
 * label and the id came from outside the wallet, so both render escaped.
 */
export function NameTargetReview({
  header,
  banner,
  label,
  target,
  fee,
  from,
  context,
  children,
  footer,
}: {
  header: ReactNode;
  banner?: ReactNode;
  label: string;
  target: string;
  fee: string | null;
  from: TransferReviewProps["from"];
  context: TransferContext;
  children?: ReactNode;
  footer: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex min-h-full flex-col">
      {header}
      {banner ? <div className={`${GUTTER} pt-5`}>{banner}</div> : null}
      <div className={`flex flex-col items-center gap-3 pb-3 pt-9 text-center ${GUTTER}`}>
        <span className="max-w-full break-words text-h2 font-semibold text-foreground">
          <UntrustedText text={`@${label}`} />
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 28"
          className="h-7 w-3 text-muted/60"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 1v25M1.5 21.5 6 26l4.5-4.5" />
        </svg>
      </div>
      {/* In silica, a lens runs from the new target down through the summary. */}
      <div className="gleam-lens-down silica:pb-6 silica:pt-4">
        <div className={`flex flex-col items-center gap-1 pb-8 text-center ${GUTTER}`}>
          <span className="text-label text-muted">{t("collectibles.pointsTo")}</span>
          <span dir="ltr" className="max-w-full break-all font-mono text-body leading-relaxed text-foreground">
            <UntrustedText text={target} />
          </span>
        </div>
        <div className={`flex flex-col gap-3.5 ${GUTTER}`}>
          {from ? <SummaryRow label={t("transferReview.from")} value={<FromValue from={from} />} /> : null}
          <SummaryRow label={t("transferReview.networkFee")} value={<FeeValue fee={fee} context={context} />} />
        </div>
      </div>
      {children ? <div className={`flex flex-col gap-3 pt-5 ${GUTTER}`}>{children}</div> : null}
      {footer}
    </div>
  );
}

/** The two-button row at the bottom of a review. */
export function ReviewButtons({
  secondaryLabel,
  onSecondary,
  primaryLabel,
  onPrimary,
  warned,
  busy = false,
  className,
}: {
  secondaryLabel: string;
  onSecondary: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
  warned: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("mt-auto grid gap-3 pb-6 pt-5", primaryLabel ? "grid-cols-2" : "grid-cols-1", GUTTER, className)}>
      <Button type="button" variant="secondary" onClick={onSecondary} className="h-12">
        {secondaryLabel}
      </Button>
      {primaryLabel && onPrimary ? (
        <Button
          type="button"
          variant={warned ? "destructive" : "primary"}
          disabled={busy}
          aria-busy={busy}
          onClick={onPrimary}
          className="h-12"
        >
          <ArmingLabel>{primaryLabel}</ArmingLabel>
        </Button>
      ) : null}
    </div>
  );
}

const PARTY_GRID = `grid grid-cols-[36px_minmax(0,1fr)] gap-x-3.5 ${GUTTER}`;

function FromParty({ from }: { from: NonNullable<TransferReviewProps["from"]> }) {
  const t = useT();
  const identity = useAddressIdentity();
  return (
    <div className={PARTY_GRID}>
      <AccountAvatar svgMarkup={identity.avatarSvg(from.address)} label="" size={36} />
      <div className="flex min-w-0 flex-col justify-center">
        <span className="text-label text-muted">{t("transferReview.from")}</span>
        <FromValue from={from} />
      </div>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 28"
        className="my-2.5 h-7 w-3 justify-self-center text-muted/60"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 1v25M1.5 21.5 6 26l4.5-4.5" />
      </svg>
      <div />
    </div>
  );
}

function ToParty({ to, toName, diffAgainst }: { to: string; toName: string | null; diffAgainst?: string }) {
  const t = useT();
  const identity = useAddressIdentity();
  return (
    <div className={PARTY_GRID}>
      <AccountAvatar svgMarkup={identity.avatarSvg(to)} label="" size={36} />
      <div className="flex min-w-0 flex-col">
        <span className="text-label text-muted">{t("transferReview.to")}</span>
        {toName ? <span className="break-words text-body font-medium text-foreground">{toName}</span> : null}
        <MemorableAddress address={to} emphasisPick={identity.emphasisPick} tone="confirm" diffAgainst={diffAgainst} />
      </div>
    </div>
  );
}

/** The hardware wallet's strip above a review once it waits for the device. */
export function DeviceBanner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-mist px-4 py-3.5">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 text-foreground">
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M10 6h4" />
        <circle cx="12" cy="16" r="2" />
      </svg>
      <span className="flex-1 text-body font-semibold text-foreground">{text}</span>
      <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-full bg-beam-sky" />
    </div>
  );
}
