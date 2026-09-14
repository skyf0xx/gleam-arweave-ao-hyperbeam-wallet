import type { ActivityEntry } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { formatWinstonAsAr } from "../../main-screen/src/formatWinston";

/**
 * Transaction detail (tokens-activity.html 4.4) — shows the full,
 * untruncated tx id and tags (RELEVANT RULES: "Transaction detail view
 * shows the full untruncated tx id and tags"). No decoded-data preview
 * or ViewBlock deep link yet: this task's `ActivityEntry` model carries
 * no raw data payload or explicit network name to build such a link
 * from — reported as a gap in this task's final report rather than
 * fabricated.
 */
export interface TransactionDetailProps {
  entry: ActivityEntry;
  onBack: () => void;
}

export function TransactionDetail({ entry, onBack }: TransactionDetailProps) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Transaction" onBack={onBack} />
      <div className="flex-1 px-5 py-4">
        <div className="flex items-center gap-2 pb-3.5">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              entry.status === "confirmed"
                ? "bg-beam-green"
                : entry.status === "failed"
                  ? "bg-beam-red"
                  : "bg-beam-yellow"
            }`}
          />
          <span className="text-label font-semibold text-foreground">{statusLabel(entry.status)}</span>
        </div>

        <div className="pb-5 text-[26px] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
          {entry.amount
            ? `${entry.type === "receive" ? "+" : "-"}${formatWinstonAsAr(entry.amount)} AR`
            : "—"}
        </div>

        <div className="flex flex-col">
          <DetailRow label={entry.type === "send" ? "To" : "From"} value={entry.address} mono />
          <DetailRow label="Tx id" value={entry.txId} mono />
          {entry.tags.length > 0 ? (
            <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
              <span className="flex-shrink-0 pt-px text-label text-muted">Tags</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                {entry.tags.map((tag, index) => (
                  <span
                    key={`${tag.name}-${index}`}
                    className="rounded-[5px] border border-line bg-mist px-1.5 py-0.5 font-mono text-[10px] text-muted"
                  >
                    {tag.name}: {tag.value}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <span className="flex-shrink-0 pt-px text-label text-muted">{label}</span>
      <span
        className={`text-right text-label font-semibold text-foreground ${mono ? "font-mono font-medium leading-relaxed" : ""}`}
        style={mono ? { wordBreak: "break-all" } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function statusLabel(status: ActivityEntry["status"]): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "failed") return "Failed";
  return "Pending confirmation";
}
