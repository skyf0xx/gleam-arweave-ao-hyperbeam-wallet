import { useState } from "react";
import type { PointsRecentEntry } from "@gleam/core";
import { ChevronIcon } from "@gleam/ui/src/primitives/chevron-icon.tsx";
import { useT } from "../../../i18n";
import { formatPoints } from "./formatPoints";
import { recentDays } from "./recentDays";

function pullRequestNumber(ref: string | null): string | null {
  return ref?.match(/\/pull\/(\d+)/)?.[1] ?? null;
}

/** `scan-award` records each bonus under its finding's ref with a `#fix` or `#best` hash. */
function findingTitle(ref: string | null): "points.sourceFinding" | "points.sourceFixBonus" | "points.sourceBestFinding" {
  if (ref?.endsWith("#best")) return "points.sourceBestFinding";
  if (ref?.endsWith("#fix")) return "points.sourceFixBonus";
  return "points.sourceFinding";
}

/**
 * Today's and yesterday's credits, folded to their sum; opened, each day
 * by source. Renders nothing when neither day has a credit.
 */
export function RecentEarnings({
  entries,
  referralPercent,
  friends,
  now = new Date(),
}: {
  entries: readonly PointsRecentEntry[];
  referralPercent: number;
  friends: number;
  now?: Date;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const days = recentDays(entries, now);
  if (days.length === 0) return null;
  const sum = days.reduce((total, day) => total + BigInt(day.totalAtomic), 0n);

  const label = (row: PointsRecentEntry): { title: string; detail: string | null } => {
    switch (row.kind) {
      case "holding":
        return { title: t("points.sourceHolding"), detail: t("points.sourceHoldingDetail") };
      case "invited":
        return { title: t("points.sourceInvited"), detail: null };
      case "founder":
        return { title: t("points.sourceFounder"), detail: null };
      case "invites":
        return {
          title: t("points.sourceInvites"),
          detail: t(friends === 1 ? "points.friendsOne" : "points.friendsMany", { count: friends, percent: referralPercent }),
        };
      case "scan":
        return { title: t("points.sourceScan"), detail: `v${row.release}` };
      case "finding": {
        const pr = pullRequestNumber(row.ref);
        return { title: t(findingTitle(row.ref)), detail: pr ? `${t("points.sourcePr", { number: pr })} · v${row.release}` : `v${row.release}` };
      }
      case "friendJoined":
        return { title: t("points.sourceFriendJoined"), detail: t("points.sourceFriendJoinedDetail", { percent: referralPercent }) };
    }
  };

  return (
    <section aria-label={t("points.recent")} className="flex flex-col gap-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="points-recent"
        onClick={() => setOpen((value) => !value)}
        className="flex items-baseline justify-between gap-4 py-1 text-body text-foreground phone:min-h-11 phone:items-center"
      >
        <span className="flex items-center gap-1.5">
          {t("points.recent")}
          <ChevronIcon open={open} />
        </span>
        <span className="text-label font-medium tabular-nums">+{formatPoints(sum.toString())}</span>
      </button>
      {open ? (
        <div id="points-recent" className="flex flex-col gap-5">
          {days.map((day) => (
            <section key={day.day} aria-label={t(`points.${day.day}`)} className="flex flex-col gap-1">
              <h3 className="text-label text-muted">{t(`points.${day.day}`)}</h3>
              <ul className="flex flex-col">
                {day.rows.map((row, index) => {
                  const { title, detail } = label(row);
                  const href = row.kind === "finding" && row.ref?.startsWith("https://") ? row.ref : null;
                  const body = (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-body text-foreground">
                          {title}
                          {href ? <span aria-hidden="true" className="ml-1 text-faint">↗</span> : null}
                        </span>
                        {detail ? <span className="text-label text-muted">{detail}</span> : null}
                      </span>
                      {"amountAtomic" in row ? (
                        <span className="whitespace-nowrap text-body tabular-nums text-foreground">
                          +{formatPoints(row.amountAtomic)}
                        </span>
                      ) : null}
                    </>
                  );
                  return (
                    <li key={`${row.kind}-${row.at}-${index}`}>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="-mx-2 flex items-baseline gap-4 rounded-md px-2 py-1.5 hover:bg-hover">
                          {body}
                        </a>
                      ) : (
                        <div className="flex items-baseline gap-4 py-1.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
