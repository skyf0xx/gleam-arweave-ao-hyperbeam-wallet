import { useState, type ReactNode } from "react";
import {
  capabilitiesFor,
  capabilityRefusal,
  INVITE_REQUIRED_MESSAGE,
  isHardwareWalletMethod,
  type PointsWalletScore,
  type RuntimePort,
  type WalletSummary,
} from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ChevronIcon } from "@gleam/ui/src/primitives/chevron-icon.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { useT } from "../../../i18n";
import { inviteLinkFor, invitesRemainingLine } from "../../../points-share";
import { FoundingGate } from "../../onboarding/src/FoundingGate";
import { usePlatform } from "../../../app-platform/context";
import { gleamUrl, howItWorksUrl, JoinNote, scanUrl } from "./JoinNote";
import { RecentEarnings } from "./RecentEarnings";
import { useSharePrompt } from "./SharePrompt";
import { formatPoints } from "./formatPoints";
import { useCopy } from "./useCopy";
import { useCountUp } from "./useCountUp";
import { useFlash } from "./useFlash";
import { useScanStats } from "./useScanStats";
import {
  useJoinPoints,
  useLeavePoints,
  usePendingInvite,
  usePointsStanding,
} from "./usePoints";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { useBackHandler } from "@gleam/ui/src/primitives/back-stack.tsx";
import { errorText } from "../../../i18n/errors";
import { CheckIcon, CopyIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";

export interface PointsViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
}

/** What a referrer earns on each referee's base points (POINTS.md § Rules). */
const REFERRAL_PERCENT = 10;

export function PointsView({ runtime, wallet, onBack }: PointsViewProps) {
  const t = useT();
  const standing = usePointsStanding(runtime, wallet);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("points.title")} onBack={onBack} />
      {standing.status === "joined" ? (
        <JoinedView runtime={runtime} wallet={wallet} standing={standing} />
      ) : standing.status === "not-joined" ? (
        <JoinView runtime={runtime} wallet={wallet} />
      ) : null}
    </div>
  );
}

/** The ink panel the site's Points pages are built on, with the beam along its top. */
function InkCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-4 rounded-lg bg-ink px-5 pb-5 pt-4 text-on-ink"
    >
      <Beam className="w-12" />
      {children}
    </section>
  );
}

function JoinView({
  runtime,
  wallet,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
}) {
  const t = useT();
  const join = useJoinPoints(runtime);
  const pending = usePendingInvite(runtime);
  const [typed, setTyped] = useState<string | null>(null);
  const inviteCode = typed ?? pending.data ?? "";
  const canJoin = capabilitiesFor(wallet.method).points;

  if (join.error instanceof Error && join.error.message === INVITE_REQUIRED_MESSAGE) {
    return (
      <FoundingGate
        runtime={runtime}
        initialUnlock={null}
        onUnlocked={() => join.mutate({ walletId: wallet.id })}
      />
    );
  }

  return (
    <form
      className="flex flex-1 flex-col gap-5 px-6 phone:px-5 pb-6 phone:pb-0 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        join.mutate({
          walletId: wallet.id,
          inviteCode: inviteCode.trim() || undefined,
        });
      }}
    >
      <InkCard label={t("points.whatAre")}>
        <p className="text-h3 font-semibold tracking-tight">
          {t("points.earnDaily")}
        </p>
        <p className="text-label text-on-ink-muted">
          {t("points.earnDailyDetail")}
        </p>
      </InkCard>

      <TextField
        label={t("points.inviteCode")}
        placeholder={t("points.inviteCodePlaceholder")}
        value={inviteCode}
        onChange={(event) => setTyped(event.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={16}
        disabled={!canJoin}
        errorMessage={
          join.error ? errorText(join.error) : undefined
        }
      />

      <ScreenFooter className="phone:order-last">
        <Button type="submit" disabled={!canJoin || join.isPending}>
          {join.isPending ? t("points.joining") : t("points.join")}
        </Button>
        {join.isPending && isHardwareWalletMethod(wallet.method) ? <DeviceApprovalNote /> : null}
        {canJoin ? (
          <JoinNote withLink={false} />
        ) : (
          <p className="text-center text-caption text-faint">{errorText(capabilityRefusal(wallet.method, "points", "join Gleam Points"))}</p>
        )}
      </ScreenFooter>

      <AboutPoints />
    </form>
  );
}

function JoinedView({
  runtime,
  wallet,
  standing,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  standing: Extract<ReturnType<typeof usePointsStanding>, { status: "joined" }>;
}) {
  const t = useT();
  const { score } = standing;
  const total = useCountUp(standing.estimateAtomic, score?.totalAtomic ?? null);
  const { copied, copy } = useCopy(inviteLinkFor(standing.membership.inviteCode));
  const seatsLeft = score?.seatsLeft ?? null;
  const prompt = useSharePrompt({ runtime, wallet, score });
  // The join welcome belongs to the standing; the other prompts are news about the invites.
  const welcome = prompt?.kind === "joined" ? prompt.text : null;
  // The count shows only right after a copy, then fades; at rest the line carries prompt news.
  const countNote = useFlash();
  const status =
    countNote.phase !== "hidden" && seatsLeft !== null ? invitesRemainingLine(seatsLeft) : welcome ? null : (prompt?.text ?? null);
  // A full code sends friends to a "full" invite page, so there's nothing to share.
  const full = seatsLeft !== null && seatsLeft <= 0;
  const friends = score?.refereeCount ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-9 px-6 phone:px-5 pb-6 pt-6">
      <Standing
        score={score}
        total={formatPoints(total.shown)}
        highlighted={total.highlighted}
        welcome={welcome}
        holdsNothing={standing.holdsNothing}
      />

      {standing.linkedElsewhere ? (
        <ReconnectNotice runtime={runtime} wallet={wallet} />
      ) : (
        <>
          <section aria-labelledby="ways-to-earn" className="flex flex-col gap-3">
            <h2 id="ways-to-earn" className="text-body text-foreground">
              {t("points.waysToEarn")}
            </h2>
            <div className="flex flex-col gap-6 rounded-xl bg-mist p-4">
              <EarnItem label={t("points.invite")}>
                {full ? (
                  <p className="text-label text-foreground">{t("points.invitesFull")}</p>
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <button
                      type="button"
                      className={cn(ACTION_LINK, copied && "text-positive")}
                      onClick={() => {
                        copy();
                        prompt?.finish();
                        countNote.flash();
                      }}
                    >
                      {copied ? t("points.copied") : t("points.inviteFriend")}
                      {copied ? <CheckIcon className={ACTION_ICON} /> : <CopyIcon className={ACTION_ICON} />}
                    </button>
                    {status ? (
                      <span
                        role="status"
                        className={cn(
                          "text-label text-muted transition-opacity duration-700 motion-reduce:transition-none",
                          countNote.phase === "fading" && "opacity-0",
                        )}
                      >
                        {status}
                      </span>
                    ) : null}
                  </div>
                )}
                <p className="mt-1.5 text-label text-muted">
                  {t("points.referralBefore")}
                  {REFERRAL_PERCENT}%{t("points.referralAfter")}
                </p>
                {friends > 0 ? (
                  <p className="text-label text-muted">
                    {t(friends === 1 ? "points.joinedOne" : "points.joinedMany", { count: friends })}
                  </p>
                ) : null}
              </EarnItem>
              <ReviewItem runtime={runtime} />
            </div>
          </section>
          <RecentEarnings
            entries={score?.recent ?? []}
            referralPercent={REFERRAL_PERCENT}
            friends={score?.refereeCount ?? 0}
          />
        </>
      )}

      <AboutPoints className="mt-auto">
        <LeaveControl
          runtime={runtime}
          wallet={wallet}
          points={formatPoints(standing.estimateAtomic)}
        />
      </AboutPoints>
    </div>
  );
}

/**
 * The place leads because it's what a member acts on, with the gap to the
 * next place under it. The total reads as a balance in the top corner and
 * turns into the percentile on a tap, so only one of them is on screen. Before the first snapshot ranks the
 * wallet, the total leads instead, with the join welcome in the line the
 * gap to the next rank uses later.
 */
function Standing({
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
          <p className="text-display-lg font-semibold leading-[1.1] tracking-[-0.03em] tabular-nums text-foreground">
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
          <span aria-hidden="true" className="text-display-lg font-semibold leading-[1.1] tracking-[-0.03em]">
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

/**
 * Shown when the server lists this wallet under another install's device.
 * Joining again from here only moves the wallet to this install (the
 * server keeps its points, invite code and referrer), so it earns from
 * this install's heartbeats again. It replaces Ways to earn so the screen
 * keeps one primary action.
 */
function ReconnectNotice({ runtime, wallet }: { runtime: RuntimePort; wallet: WalletSummary }) {
  const t = useT();
  const join = useJoinPoints(runtime);

  return (
    <section aria-label={t("points.elsewhereTitle")} className="flex flex-col gap-3">
      <h2 className="text-h3 font-semibold text-foreground">{t("points.elsewhereTitle")}</h2>
      <p className="text-label text-muted">
        {t("points.elsewhereBody")}
      </p>
      <Button type="button" disabled={join.isPending} onClick={() => join.mutate({ walletId: wallet.id })}>
        {join.isPending ? t("points.joining") : t("points.joinAgain")}
      </Button>
      {join.isPending && isHardwareWalletMethod(wallet.method) ? <DeviceApprovalNote /> : null}
      {join.error instanceof Error ? <p className="text-caption text-warning">{errorText(join.error)}</p> : null}
    </section>
  );
}

/** One way to earn: what it pays, then its action, which names it. */
function EarnItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      {children}
    </section>
  );
}

/** Earn actions are text, not buttons, so nothing competes with the place above. */
const ACTION_LINK =
  "self-start text-body font-medium text-foreground hover:underline phone:min-h-11";

/**
 * Reviews need a registered wallet, so only members see this. The button
 * stays once the paid places are gone: an unpaid review is still published
 * and a confirmed vulnerability still earns from the bounty pool.
 */
function ReviewItem({ runtime }: { runtime: RuntimePort }) {
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

/**
 * The footer, folded so nothing competes with the screen's one action.
 * Opened, the two reading links lead and anything passed in (Leave) sits
 * apart below them, quieter.
 */
function AboutPoints({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const { version } = usePlatform().buildInfo;
  const [open, setOpen] = useState(false);

  return (
    <footer className={cn("flex flex-col items-center gap-3", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="points-about"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-caption text-muted hover:text-foreground phone:min-h-11"
      >
        {t("points.about")}
        <ChevronIcon open={open} />
      </button>
      {open ? (
        <div id="points-about" className="flex w-full flex-col gap-4">
          <ul className="flex flex-col gap-6">
            <AboutLink
              href={howItWorksUrl(version)}
              title={t("points.howToEarn")}
              detail={t("points.howToEarnDetail")}
            />
            <AboutLink
              href={gleamUrl(version)}
              title={t("points.future")}
              detail={t("points.futureDetail")}
            />
          </ul>
          {children ? (
            <div className="flex justify-center">{children}</div>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}

function AboutLink({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-mist phone:px-0"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-label font-semibold text-foreground">
            {title}
          </span>
          <span className="text-caption text-muted">{detail}</span>
        </span>
        <span aria-hidden="true" className="text-muted">
          ↗
        </span>
      </a>
    </li>
  );
}

function LeaveControl({
  runtime,
  wallet,
  points,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  points: string;
}) {
  const t = useT();
  const leave = useLeavePoints(runtime);
  const [confirming, setConfirming] = useState(false);
  useBackHandler(confirming ? () => setConfirming(false) : null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-label text-faint hover:text-muted"
      >
        {t("points.leave")}
      </button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label={t("points.leave")}
      className="flex w-full flex-col gap-3 rounded-lg border border-line p-4"
    >
      <p className="text-label text-foreground">
        {t("points.leaveWarning", { points })}
      </p>
      {leave.error instanceof Error ? (
        <p className="text-caption text-warning">{errorText(leave.error)}</p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={() => setConfirming(false)}
        >
          {t("points.cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="flex-1"
          disabled={leave.isPending}
          onClick={() => leave.mutate({ walletId: wallet.id })}
        >
          {leave.isPending ? t("points.leaving") : t("points.leaveConfirm")}
        </Button>
      </div>
      {leave.isPending && isHardwareWalletMethod(wallet.method) ? <DeviceApprovalNote /> : null}
    </div>
  );
}

/** A hardware wallet proves ownership on the device, in the approval window the background opens. */
function DeviceApprovalNote() {
  const t = useT();
  return (
    <p role="status" className="text-center text-caption text-muted">
      {t("points.deviceApproval")}
    </p>
  );
}

/** Sized and aligned to sit after an earn action's text, like the scan link's ↗. */
const ACTION_ICON = "ml-1.5 inline-block align-[-0.125em]";

