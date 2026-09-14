import { useEffect, useState } from "react";
import type { ActivityEntry, ActivityPage, RuntimePort, WalletSummary } from "@gleam/core";
import { ActivityRow, EmptyState, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/components/onboarding/index.ts";
import { formatWinstonAsAr, truncateAddress } from "../../main-screen/src/formatWinston";
import { TransactionDetail } from "./TransactionDetail";

/**
 * All-activity list + transaction detail (tokens-activity.html 4.3/4.4).
 * Internal step state only, matching Onboarding/UnlockView's "no router"
 * pattern one level down inside a single view module.
 */
export interface ActivityViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
}

type Step = { kind: "list" } | { kind: "detail"; entry: ActivityEntry };

export function ActivityView({ runtime, wallet, onBack }: ActivityViewProps) {
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runtime
      .send<{ address: string }, ActivityPage>({
        type: "getActivity",
        payload: { address: wallet.address },
      })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, wallet.address]);

  if (step.kind === "detail") {
    return <TransactionDetail entry={step.entry} onBack={() => setStep({ kind: "list" })} />;
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Activity" onBack={onBack} />
      <div className="flex-1 px-5 py-4">
        {loading ? (
          <div className="rounded-[10px] border border-[#e5e5e5] px-3">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : error ? (
          <p className="text-xs text-[#737373]">{error}</p>
        ) : !page || page.entries.length === 0 ? (
          <EmptyState message="No activity yet. Once you send, receive, or upload, it'll show up here." />
        ) : (
          <div className="rounded-[10px] border border-[#e5e5e5] px-3">
            {page.entries.map((entry) => (
              <ActivityRow
                key={entry.txId}
                activityType={entry.type}
                title={`${activityVerb(entry.type)} · ${truncateAddress(entry.address)}`}
                subtitle={entry.status === "pending" ? "Pending confirmation" : relativeTime(entry.timestamp)}
                amountLabel={
                  entry.amount ? `${entry.type === "receive" ? "+" : "-"}${formatWinstonAsAr(entry.amount)} AR` : "—"
                }
                amountTone={entry.type === "receive" ? "positive" : "neutral"}
                pending={entry.status === "pending"}
                onClick={() => setStep({ kind: "detail", entry })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function activityVerb(type: "send" | "receive" | "upload"): string {
  if (type === "send") return "Sent";
  if (type === "receive") return "Received";
  return "Uploaded";
}

function relativeTime(timestampMs: number): string {
  if (timestampMs <= 0) return "Pending";
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
