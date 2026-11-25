import { useState } from "react";
import type { PointsWalletScore } from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { useT } from "../../../i18n";
import { formatPoints } from "./formatPoints";

/**
 * The place leads because it's what a member acts on, with the gap to the
 * next place under it. The total reads as a balance in the top corner and
 * turns into the percentile on a tap, so only one of them is on screen. Before the first snapshot ranks the
 * wallet, the total leads instead, with the join welcome in the line the
 * gap to the next rank uses later.
 */
export function Standing({
  score,
  total,
  highlighted,
  welcome,
  holdsNothing,
}: {
  score: PointsWalletScore | null | undefined;
  total: string;
  highlighted: boolean;
  welcome: string | null;
  holdsNothing: boolean;
}) {
  const t = useT();
  const rank = score?.rank ?? null;
  const toNext =
    rank !== null && score?.pointsToNextRankAtomic != null
      ? t("points.toNextRank", { amount: formatPoints(score.pointsToNextRankAtomic), next: rank - 1 })
      : null;
  const totalText = (
    <span className={cn("tabular-nums transition-colors duration-700 motion-reduce:transition-none", highlighted && "text-positive")}>
      {total}
    </span>
  );
  // The leader skips "Top N%" because an only ranked wallet is also "Top 100%".
  const percent = rank !== 1 && score?.topPercent != null ? t("points.top", { percent: score.topPercent }) : null;
  const [showPercent, setShowPercent] = useState(false);
  const line = welcome ?? toNext;

  return (
    <section aria-label={t("points.standing")} className="relative flex flex-col gap-2">
      <Beam className="mb-2 w-10" />
      {rank !== null ? (
        <>
          <p className="text-display-lg font-semibold dark:font-medium leading-[1.1] tracking-[-0.03em] tabular-nums text-foreground">
            {t("points.rank", { rank })}
          </p>
          {/* After the rank in reading order, drawn on the beam's row. */}
          <div className="absolute right-0 top-[1.5px] -translate-y-1/2 text-body text-muted">
            {percent ? (
              // The dashed underline says the figure has another reading: the percentile.
              <button
                type="button"
                aria-pressed={showPercent}
                onClick={() => setShowPercent((value) => !value)}
                className="underline decoration-line decoration-dashed underline-offset-4 hover:text-foreground hover:decoration-faint phone:min-h-11"
              >
                {showPercent ? (
                  percent
                ) : (
                  <>
                    <span className="sr-only">{t("points.pointsAmount", { amount: total })}</span>
                    <span aria-hidden="true">
                      {totalText} {t("points.unit")}
                    </span>
                  </>
                )}
              </button>
            ) : (
              <p>
                <span className="sr-only">{t("points.pointsAmount", { amount: total })}</span>
                <span aria-hidden="true">
                  {totalText} {t("points.unit")}
                </span>
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="flex items-baseline gap-2 text-foreground">
          <span className="sr-only">{t("points.pointsAmount", { amount: total })}</span>
          <span aria-hidden="true" className="text-display-lg font-semibold dark:font-medium leading-[1.1] tracking-[-0.03em]">
            {totalText}
          </span>
          <span aria-hidden="true" className="text-body text-muted">
            {t("points.unit")}
          </span>
        </p>
      )}
      {line ? <p className="text-h3 text-foreground">{line}</p> : null}
      {!welcome && toNext ? <p className="text-label text-muted">{t("points.holdToClimb")}</p> : null}
      {rank === null && score ? (
        <p className="text-body text-muted">{t(holdsNothing ? "points.holdToEarn" : "points.unrankedHint")}</p>
      ) : null}
      {score?.originalFounder ? <p className="text-label text-faint">{t("points.earlyMember")}</p> : null}
    </section>
  );
}
