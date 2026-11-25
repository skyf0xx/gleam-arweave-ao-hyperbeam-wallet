import type { ReactNode } from "react";
import type { RuntimePort } from "@gleam/core";
import { useT } from "../../../i18n";
import { usePlatform } from "../../../app-platform/context";
import { scanUrl } from "./JoinNote";
import { formatPoints } from "./formatPoints";
import { useScanStats } from "./useScanStats";

/** One way to earn: what it pays, then its action, which names it. */
export function EarnItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      {children}
    </section>
  );
}

/** Earn actions are text, not buttons, so nothing competes with the place above. */
export const ACTION_LINK =
  "self-start text-body font-medium text-foreground hover:underline phone:min-h-11";

/**
 * Reviews need a registered wallet, so only members see this. The button
 * stays once the paid places are gone: an unpaid review is still published
 * and a confirmed vulnerability still earns from the bounty pool.
 */
export function ReviewItem({ runtime }: { runtime: RuntimePort }) {
  const t = useT();
  const { version } = usePlatform().buildInfo;
  const stats = useScanStats(runtime);
  const placesLeft = stats.data?.paidPlacesLeft ?? null;
  const rewardAtomic = stats.data?.rewardAtomic ?? null;
  const pool = stats.data?.bountyPoolAtomic ? formatPoints(stats.data.bountyPoolAtomic) : null;
  const paying = placesLeft !== null && placesLeft > 0;

  return (
    <EarnItem label={t("points.review")}>
      <a href={`${scanUrl(version)}#review`} target="_blank" rel="noreferrer" className={ACTION_LINK}>
        {t("points.startReview")}
        <span aria-hidden="true"> ↗</span>
      </a>
      <p className="mt-1.5 text-label text-muted">
        <span>
          {paying && rewardAtomic
            ? `${t("points.reviewEarnBefore")}${formatPoints(rewardAtomic)} GLEAM${t("points.reviewEarnAfter")}`
            : t("points.reviewPlain")}
        </span>{" "}
        {placesLeft === 0 ? (
          <span>{pool ? t("points.placesTakenPool", { pool }) : t("points.placesTaken")}</span>
        ) : pool ? (
          <span>{t("points.poolPlus", { pool })}</span>
        ) : null}
      </p>
    </EarnItem>
  );
}

/** Sized and aligned to sit after an earn action's text, like the scan link's ↗. */
export const ACTION_ICON = "ml-1.5 inline-block align-[-0.125em]";
