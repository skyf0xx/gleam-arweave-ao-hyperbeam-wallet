import { useState, type ReactNode } from "react";
import {
  capabilitiesFor,
  INVITE_REQUIRED_MESSAGE,
  isHardwareWalletMethod,
  unsupportedOperationMessage,
  type RuntimePort,
  type WalletSummary,
} from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ChevronIcon } from "@gleam/ui/src/primitives/chevron-icon.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { inviteLinkFor, invitesRemainingLine } from "../../../points-share";
import { FoundingGate } from "../../onboarding/src/FoundingGate";
import { usePlatform } from "../../../app-platform/context";
import { gleamUrl, howItWorksUrl, JoinNote, scanUrl } from "./JoinNote";
import { useSharePrompt } from "./SharePrompt";
import { formatPoints } from "./formatPoints";
import { useCopy } from "./useCopy";
import { useCountUp } from "./useCountUp";
import { useScanStats } from "./useScanStats";
import {
  useJoinPoints,
  useLeavePoints,
  usePendingInvite,
  usePointsStanding,
} from "./usePoints";

export interface PointsViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
}

/** The seats a member code starts with (POINTS.md § Invites). */
const MEMBER_SEATS = 3;

/** What a referrer earns on each referee's base points (POINTS.md § Rules). */
const REFERRAL_PERCENT = 10;

const BEAM_COLORS = [
  "var(--color-beam-red)",
  "var(--color-beam-purple)",
  "var(--color-beam-sky)",
  "var(--color-beam-yellow)",
  "var(--color-beam-green)",
];

export function PointsView({ runtime, wallet, onBack }: PointsViewProps) {
  const standing = usePointsStanding(runtime, wallet);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Gleam Points" onBack={onBack} />
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
      className="flex flex-1 flex-col gap-5 px-6 pb-6 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        join.mutate({
          walletId: wallet.id,
          inviteCode: inviteCode.trim() || undefined,
        });
      }}
    >
      <InkCard label="What Gleam Points are">
        <p className="text-h3 font-semibold tracking-tight">
          Earn Gleam Points every day
        </p>
        <p className="text-label text-on-ink-muted">
          Every AR and AO you hold earns points daily. Bigger balances (whales) earn on a curve, so points stay fair.
        </p>
      </InkCard>

      <TextField
        label="Invite code"
        placeholder="Optional. Earn more with an invite code."
        value={inviteCode}
        onChange={(event) => setTyped(event.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={16}
        disabled={!canJoin}
        errorMessage={
          join.error instanceof Error ? join.error.message : undefined
        }
      />

      <div className="mt-auto flex flex-col gap-3">
        <Button type="submit" disabled={!canJoin || join.isPending}>
          {join.isPending ? "Joining…" : "Join Gleam Points"}
        </Button>
        {join.isPending && isHardwareWalletMethod(wallet.method) ? <DeviceApprovalNote /> : null}
        {canJoin ? (
          <JoinNote withLink={false} />
        ) : (
          <p className="text-center text-caption text-faint">{unsupportedOperationMessage("join Gleam Points")}</p>
        )}
      </div>

      <AboutPoints />
    </form>
  );
}

/** The total the way the site draws it: whole points large, decimals and unit beside them. */
function PointsTotal({ value, highlighted }: { value: string; highlighted: boolean }) {
  const [whole, decimals] = value.split(".");
  return (
    <p className="flex items-end gap-1 leading-none">
      <span className="sr-only">{value} points</span>
      <span
        aria-hidden="true"
        className={cn(
          "text-[44px] font-bold tracking-[-0.05em] tabular-nums transition-colors duration-700 motion-reduce:transition-none",
          highlighted && "text-positive",
        )}
      >
        {whole}
      </span>
      <span aria-hidden="true" className="flex flex-col gap-1 pb-1">
        {decimals ? (
          <span className="text-h3 font-semibold tabular-nums text-on-ink-muted">
            .{decimals}
          </span>
        ) : null}
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-on-ink-muted">
          Points
        </span>
      </span>
    </p>
  );
}

function InkStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-on-ink-muted">{label}</dt>
      <dd className="min-h-5 text-body font-semibold tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/**
 * One square per seat on the member's code, lit in beam order while it's open.
 * Seats have no cap, so the row stops at one full beam and the text beside it
 * carries the exact count.
 */
function Seats({ left }: { left: number }) {
  const total = Math.min(Math.max(left, MEMBER_SEATS), BEAM_COLORS.length);
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={
            index < left
              ? "h-2.5 w-2.5 rounded-[2px]"
              : "h-2.5 w-2.5 rounded-[2px] border border-line"
          }
          style={
            index < left
              ? { backgroundColor: BEAM_COLORS[index % BEAM_COLORS.length] }
              : undefined
          }
        />
      ))}
    </span>
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
  const { score } = standing;
  const total = useCountUp(standing.estimateAtomic, score?.totalAtomic ?? null);
  const { copied, copy } = useCopy(inviteLinkFor(standing.membership.inviteCode));
  const seatsLeft = score?.seatsLeft ?? null;
  const prompt = useSharePrompt({ runtime, wallet, score });
  const status = prompt?.text ?? (seatsLeft !== null ? invitesRemainingLine(seatsLeft) : null);
  // A full code sends friends to a "full" invite page, so there's nothing to share.
  const full = seatsLeft !== null && seatsLeft <= 0;
  const topPercent = score?.topPercent ?? null;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 pb-6 pt-5">
      <InkCard label="Standing">
        <div className="flex flex-col gap-2">
          <PointsTotal value={formatPoints(total.shown)} highlighted={total.highlighted} />
          {score?.originalFounder ? (
            <span className="text-label text-on-ink-muted">
              Earning 10% more as an early member
            </span>
          ) : null}
        </div>
        <dl className="grid grid-cols-3 gap-3 border-t border-ink-line pt-3">
          <InkStat label="Per day">
            +{formatPoints(standing.dailyRateAtomic)}
          </InkStat>
          <InkStat label="Rank">
            {/* The leader is "#1" because an only ranked wallet is also "Top 100%". */}
            {!score ? (
              "—"
            ) : score.rank === 1 ? (
              "#1"
            ) : topPercent !== null ? (
              `Top ${topPercent}%`
            ) : (
              <span
                title="You're ranked once a daily snapshot credits your points. Snapshots run just after midnight UTC."
                className="cursor-help underline decoration-dotted underline-offset-4"
              >
                Unranked
              </span>
            )}
          </InkStat>
          <InkStat label="Friends joined">{score?.refereeCount ?? 0}</InkStat>
        </dl>
        {score?.rank != null && score.pointsToNextRankAtomic !== null ? (
          <p className="text-label text-on-ink-muted">
            You're #{score.rank}. {formatPoints(score.pointsToNextRankAtomic)} points to pass #{score.rank - 1}.
          </p>
        ) : null}
      </InkCard>

      {standing.linkedElsewhere ? (
        <ReconnectNotice runtime={runtime} wallet={wallet} />
      ) : (
        <section aria-labelledby="ways-to-earn" className="flex flex-col gap-3">
          <h2 id="ways-to-earn" className="text-h3 font-semibold text-foreground">
            Ways to earn
          </h2>
          <div className="flex flex-col gap-6">
            <EarnItem label="Invite" title="Invite a friend">
              <div className="flex flex-col gap-1">
                <p className="text-label text-muted">
                  Earn an extra <Reward>{REFERRAL_PERCENT}%</Reward> daily for every friend who joins.
                </p>
                {status ? (
                  <p className="flex items-center gap-2 text-caption text-muted">
                    {seatsLeft !== null ? <Seats left={seatsLeft} /> : null}
                    {status}
                  </p>
                ) : null}
                {full ? (
                  <p className="text-caption text-muted">You get two more when a friend you invited joins Points.</p>
                ) : null}
              </div>
              {full ? null : (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={cn(copied && "text-positive")}
                    onClick={() => {
                      copy();
                      prompt?.finish();
                    }}
                  >
                    {copied ? "Copied" : "Copy invite link"}
                  </Button>
                </div>
              )}
            </EarnItem>
            <ReviewItem runtime={runtime} />
          </div>
        </section>
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
 * Shown when the server lists this wallet under another install's device.
 * Joining again from here only moves the wallet to this install (the
 * server keeps its points, invite code and referrer), so it earns from
 * this install's heartbeats again. It replaces Ways to earn so the screen
 * keeps one primary action.
 */
function ReconnectNotice({ runtime, wallet }: { runtime: RuntimePort; wallet: WalletSummary }) {
  const join = useJoinPoints(runtime);

  return (
    <section aria-label="Reconnect" className="flex flex-col gap-3">
      <h2 className="text-h3 font-semibold text-foreground">Linked to another browser</h2>
      <p className="text-label text-muted">
        Your points are linked to another browser and stop growing when Gleam stops running there. Reconnect to earn
        here. You'll keep your points and invite link.
      </p>
      <Button type="button" disabled={join.isPending} onClick={() => join.mutate({ walletId: wallet.id })}>
        {join.isPending ? "Reconnecting…" : "Reconnect this browser"}
      </Button>
      {join.isPending && isHardwareWalletMethod(wallet.method) ? <DeviceApprovalNote /> : null}
      {join.error instanceof Error ? <p className="text-caption text-warning">{join.error.message}</p> : null}
    </section>
  );
}

/**
 * One way to earn: a hairline, its title, then what it pays and its
 * actions. Every way shares this shape and a small outlined
 * action, so none reads as more important than the others.
 */
function EarnItem({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-body font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** What a way to earn pays, picked out of its muted sentence the way the ink card sets its figures. */
function Reward({ children }: { children: ReactNode }) {
  return <span className="font-semibold tabular-nums text-foreground">{children}</span>;
}

/**
 * Reviews need a registered wallet, so only members see this. The button
 * stays once the paid places are gone: an unpaid review is still published
 * and a confirmed vulnerability still earns from the bounty pool.
 */
function ReviewItem({ runtime }: { runtime: RuntimePort }) {
  const { version } = usePlatform().buildInfo;
  const stats = useScanStats(runtime);
  const placesLeft = stats.data?.paidPlacesLeft ?? null;
  const rewardAtomic = stats.data?.rewardAtomic ?? null;
  const pool = stats.data?.bountyPoolAtomic ? formatPoints(stats.data.bountyPoolAtomic) : null;
  const paying = placesLeft !== null && placesLeft > 0;

  return (
    <EarnItem label="Review" title="Review a release">
      <div className="flex flex-col gap-1">
        <p className="text-label text-muted">
          {paying && rewardAtomic ? (
            <>
              Earn <Reward>{formatPoints(rewardAtomic)} GLEAM</Reward> to review Gleam with your coding agent.
            </>
          ) : (
            "Review Gleam with your coding agent."
          )}
        </p>
        {placesLeft === 0 ? (
          <p className="text-caption text-muted">
            {pool
              ? `Paid places for this release are taken. Confirmed vulnerabilities still share the ${pool} GLEAM bounty pool.`
              : "Paid places for this release are taken. Confirmed vulnerabilities still earn a share of the bounty pool."}
          </p>
        ) : pool ? (
          <p className="text-caption text-muted">{`Plus a ${pool} GLEAM bounty pool for confirmed vulnerabilities.`}</p>
        ) : null}
      </div>
      <Button asChild variant="secondary" size="sm" className="self-start">
        <a href={`${scanUrl(version)}#review`} target="_blank" rel="noreferrer">
          Start a review
          <span aria-hidden="true">↗</span>
        </a>
      </Button>
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
  const { version } = usePlatform().buildInfo;
  const [open, setOpen] = useState(false);

  return (
    <footer className={cn("flex flex-col items-center gap-3", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="points-about"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-caption text-muted hover:text-foreground"
      >
        About Gleam Points
        <ChevronIcon open={open} />
      </button>
      {open ? (
        <div id="points-about" className="flex w-full flex-col gap-4">
          <ul className="flex flex-col gap-6">
            <AboutLink
              href={howItWorksUrl(version)}
              title="How to earn points"
              detail="Rates, invites and the rules"
            />
            <AboutLink
              href={gleamUrl(version)}
              title="The future of Gleam"
              detail="What your points will become"
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
        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-mist"
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
  const leave = useLeavePoints(runtime);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-label text-faint hover:text-muted"
      >
        Leave Gleam Points
      </button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label="Leave Gleam Points"
      className="flex w-full flex-col gap-3 rounded-lg border border-line p-4"
    >
      <p className="text-label text-foreground">
        You'll lose your {points} points and your invite link will stop working.
        This cannot be undone.
      </p>
      {leave.error instanceof Error ? (
        <p className="text-caption text-warning">{leave.error.message}</p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="flex-1"
          disabled={leave.isPending}
          onClick={() => leave.mutate({ walletId: wallet.id })}
        >
          {leave.isPending ? "Leaving…" : "Leave"}
        </Button>
      </div>
      {leave.isPending && isHardwareWalletMethod(wallet.method) ? <DeviceApprovalNote /> : null}
    </div>
  );
}

/** A hardware wallet proves ownership on the device, in the approval window the background opens. */
function DeviceApprovalNote() {
  return (
    <p role="status" className="text-center text-caption text-muted">
      Approve on your device in the window that opened.
    </p>
  );
}
