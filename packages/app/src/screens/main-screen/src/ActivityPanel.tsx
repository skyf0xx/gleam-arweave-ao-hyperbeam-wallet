import { useState } from "react";
import type { ActivityEntry, ActivityPage, RuntimePort, TokenBalance, WalletSummary } from "@gleam/core";
import { ActivityRow, EmptyState, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { useLocale, useT } from "../../../i18n";
import { relativeTime } from "../../../relative-time";
import { ActivityDetailSheet, type ActivityDetail } from "./ActivityDetailSheet";
import {
  activityTitle,
  collectibleLabel,
  formatActivityAmount,
  formatDataSize,
  openInExplorer,
  swapAssetLabel,
  uploadTitle,
} from "./activityLabels";

// The rest of the history is one click away through "View all".
const ACTIVITY_PREVIEW_LIMIT = 6;

export interface ActivityPanelProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  /** No balances or activity read has finished yet. */
  showSkeleton: boolean;
  /** Restored from the cache and now refreshed. */
  fresh: boolean;
  activity: ActivityPage | undefined;
  tokenBalances: TokenBalance[] | undefined;
  /** The saved contact or own-wallet name for an address, if any. */
  nameFor: (address: string) => string | undefined;
  /** Where the activity detail sheet mounts (see `Sheet`'s `container`). */
  sheetContainer: HTMLElement | null;
  /** Opens send prefilled with `address`, for AR (`null`) or that token, from an activity entry's detail. */
  onSendTo?: (address: string, token: TokenBalance | null) => void;
}

/** The Activity tab: the latest entries, "View all", and the detail sheet a row opens. */
export function ActivityPanel({ runtime, wallet, showSkeleton, fresh, activity, tokenBalances, nameFor, sheetContainer, onSendTo }: ActivityPanelProps) {
  const t = useT();
  const locale = useLocale();
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  // A send is offered only for AR or a token whose balance (and so denomination) is loaded.
  const sendableToken = (entry: ActivityEntry): TokenBalance | null | undefined => {
    if (entry.collectible || entry.swap || entry.type === "upload") return undefined;
    if (!entry.token) return null;
    const match = tokenBalances?.find((token) => token.processId === entry.token);
    return match && match.available !== false ? match : undefined;
  };
  return (
    <>
      <div
        className={`min-h-60 phone:min-h-0 ${fresh ? "gleam-fresh" : ""}`}
      >
        {showSkeleton ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : !activity || activity.entries.length === 0 ? (
          <EmptyState message={t("mainScreen.noActivity")} />
        ) : (
          activity.entries.slice(0, ACTIVITY_PREVIEW_LIMIT).map((entry) => {
            const title =
                entry.swap
                  ? t("mainScreen.swapOrder", { asset: swapAssetLabel(entry.swap.process, tokenBalances) })
                  : entry.type === "upload" && !entry.collectible
                  ? uploadTitle(t, entry)
                  : activityTitle(
                      t,
                      entry.type,
                      entry.collectible ? collectibleLabel(t, entry.collectible) : (nameFor(entry.address) ?? truncateAddress(entry.address, 6)),
                      Boolean(entry.collectible),
                    );
            const subtitle =
                entry.swap && entry.status === "confirmed"
                  ? entry.timestamp > 0
                    ? t("mainScreen.orderPlacedAt", { time: relativeTime(t, entry.timestamp) })
                    : t("mainScreen.orderPlaced")
                  : entry.unverified
                  ? entry.timestamp > 0
                    ? t("mainScreen.unverifiedTransferAt", { time: relativeTime(t, entry.timestamp) })
                    : t("mainScreen.unverifiedTransfer")
                  : entry.status === "pending"
                  ? t("mainScreen.pendingConfirmation")
                  : entry.status === "failed"
                    ? entry.error
                      ? t("mainScreen.failedWithError", { error: entry.error })
                      : t("mainScreen.failed")
                    : relativeTime(t, entry.timestamp);
            const amountLabel = entry.amount
              ? `${entry.type === "receive" ? "+" : "-"}${formatActivityAmount(entry, tokenBalances)}`
              : entry.dataSize
                ? formatDataSize(entry.dataSize, locale)
                : undefined;
            const token = sendableToken(entry);
            return (
            <ActivityRow
              key={entry.txId}
              activityType={entry.swap ? "swap" : entry.type}
              title={title}
              subtitle={subtitle}
              amountLabel={amountLabel}
              outcomeUnknown={Boolean(entry.swap)}
              amountTone={entry.type === "send" && entry.status !== "failed" ? "negative" : entry.type === "receive" && !entry.unverified ? "positive" : "neutral"}
              collectible={
                entry.collectible
                  ? { name: collectibleLabel(t, entry.collectible), imageUrl: entry.collectible.imageUrl }
                  : undefined
              }
              pending={entry.status === "pending"}
              onClick={() =>
                setDetail({
                  entry,
                  title,
                  subtitle,
                  amountLabel,
                  name: nameFor(entry.address),
                  onSendTo: token === undefined || !onSendTo ? undefined : () => onSendTo(entry.address, token),
                })
              }
            />
            );
          })
        )}
      </div>
      {activity && activity.entries.length > 0 ? (
        <div className="pt-2.5 text-center phone:pt-1">
          <Button
            variant="link"
            size="bare"
            type="button"
            onClick={() => openInExplorer(wallet.address)}
            className="phone:min-h-11 phone:px-4"
          >
            {t("mainScreen.viewAll")}
          </Button>
        </div>
      ) : null}
      <ActivityDetailSheet
        runtime={runtime}
        detail={detail}
        onClose={() => setDetail(null)}
        onViewInExplorer={openInExplorer}
        container={sheetContainer}
      />
    </>
  );
}
