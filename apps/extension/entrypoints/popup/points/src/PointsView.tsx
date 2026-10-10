import { useState, type ReactNode } from "react";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { inviteLinkFor, invitePost, invitesLine, xIntentUrl } from "@/src/points-share";
import { gleamUrl, howItWorksUrl, JoinNote } from "./JoinNote";
import { useSharePrompt } from "./SharePrompt";
import { formatPoints } from "./formatPoints";
import { useCopy } from "./useCopy";
import { useJoinPoints, useLeavePoints, usePendingInvite, usePointsStanding } from "./usePoints";

export interface PointsViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
}

/** The seats a member code starts with (POINTS.md § Invites). */
const MEMBER_SEATS = 3;

/**
 * Rank shows only in the top half. Below that, and for the last-placed or
 * only ranked wallet that the server reports as "Top 100%", it reads as a
 * put-down rather than a reason to invite.
 */
const RANK_SHOWN_MAX_PERCENT = 50;

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
    <section aria-label={label} className="flex flex-col gap-4 rounded-lg bg-ink px-5 pb-5 pt-4 text-on-ink">
      <Beam className="w-12" />
      {children}
    </section>
  );
}

function JoinView({ runtime, wallet }: { runtime: RuntimePort; wallet: WalletSummary }) {
  const join = useJoinPoints(runtime);
  const pending = usePendingInvite(runtime);
  const [typed, setTyped] = useState<string | null>(null);
  const inviteCode = typed ?? pending.data ?? "";

  return (
    <form
      className="flex flex-1 flex-col gap-5 px-6 pb-6 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        join.mutate({ walletId: wallet.id, inviteCode: inviteCode.trim() || undefined });
      }}
    >
      <InkCard label="About Gleam Points">
        <p className="text-h3 font-semibold tracking-tight">Earn points every day for the AR and AO you hold.</p>
        <p className="text-label text-on-ink-muted">Invite friends and you both earn more.</p>
      </InkCard>

      <TextField
        label="Invite code"
        placeholder="Optional. Adds 10% every day."
        value={inviteCode}
        onChange={(event) => setTyped(event.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={16}
        errorMessage={join.error instanceof Error ? join.error.message : undefined}
      />

      <div className="mt-auto flex flex-col gap-3">
        <Button type="submit" disabled={join.isPending}>
          {join.isPending ? "Joining…" : "Join Gleam Points"}
        </Button>
        <JoinNote />
      </div>
    </form>
  );
}

/** The total the way the site draws it: whole points large, decimals and unit beside them. */
function PointsTotal({ value }: { value: string }) {
  const [whole, decimals] = value.split(".");
  return (
    <p className="flex items-end gap-1 leading-none">
      <span className="sr-only">{value} points</span>
      <span aria-hidden="true" className="text-[44px] font-bold tracking-[-0.05em] tabular-nums">
        {whole}
      </span>
      <span aria-hidden="true" className="flex flex-col gap-1 pb-1">
        {decimals ? <span className="text-h3 font-semibold tabular-nums text-on-ink-muted">.{decimals}</span> : null}
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-on-ink-muted">Points</span>
      </span>
    </p>
  );
}

function InkStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-on-ink-muted">{label}</dt>
      <dd className="min-h-5 text-body font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** One square per seat on the member's code, lit in beam order while it's open. */
function Seats({ left }: { left: number }) {
  const total = Math.max(left, MEMBER_SEATS);
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={index < left ? "h-2.5 w-2.5 rounded-[2px]" : "h-2.5 w-2.5 rounded-[2px] border border-line"}
          style={index < left ? { backgroundColor: BEAM_COLORS[index % BEAM_COLORS.length] } : undefined}
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
  const inviteCode = standing.membership.inviteCode;
  const inviteLink = inviteLinkFor(inviteCode);
  const { copied, copy } = useCopy(inviteLink);
  const seatsLeft = score?.seatsLeft ?? null;
  const prompt = useSharePrompt({ runtime, wallet, inviteCode, score });
  const post = prompt?.post ?? invitePost({ seats: seatsLeft, link: inviteLink });
  const heading = prompt?.text ?? (seatsLeft !== null ? invitesLine(seatsLeft) : "Invite friends");
  // A full code sends friends to a "full" invite page, so there's nothing to share.
  const full = seatsLeft !== null && seatsLeft <= 0;
  const topPercent = score?.topPercent ?? null;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 pb-6 pt-5">
      <InkCard label="Standing">
        <div className="flex flex-col gap-2">
          <PointsTotal value={formatPoints(standing.estimateAtomic)} />
          {score?.originalFounder ? (
            <span className="text-label text-on-ink-muted">Early member bonus · +10% daily</span>
          ) : null}
        </div>
        <dl className="grid grid-cols-3 gap-3 border-t border-ink-line pt-3">
          <InkStat label="Per day">+{formatPoints(standing.dailyRateAtomic)}</InkStat>
          <InkStat label="Rank">
            {topPercent !== null && topPercent <= RANK_SHOWN_MAX_PERCENT ? `Top ${topPercent}%` : "—"}
          </InkStat>
          <InkStat label="Friends joined">{score?.refereeCount ?? 0}</InkStat>
        </dl>
      </InkCard>

      <section aria-label="Invite" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-h3 font-semibold text-foreground">{heading}</h2>
          {seatsLeft !== null ? <Seats left={seatsLeft} /> : null}
        </div>
        {full ? (
          <p className="text-label text-muted">You get another when a friend you invited joins Points.</p>
        ) : (
          <>
            <p className="text-label text-muted">Earn more points by inviting friends.</p>
            <div className="mt-1 flex flex-col items-center gap-3">
              <Button asChild>
                <a href={xIntentUrl(post)} target="_blank" rel="noreferrer" onClick={() => prompt?.finish()}>
                  Invite on X
                </a>
              </Button>
              <button
                type="button"
                className="text-label text-muted underline hover:text-foreground"
                onClick={() => {
                  copy();
                  prompt?.finish();
                }}
              >
                {copied ? "Copied" : "Copy invite link"}
              </button>
            </div>
          </>
        )}
      </section>

      <footer className="mt-auto flex flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <a href={howItWorksUrl()} target="_blank" rel="noreferrer" className="text-label text-muted underline hover:text-foreground">
            How points work
          </a>
          <a href={gleamUrl()} target="_blank" rel="noreferrer" className="text-label text-muted underline hover:text-foreground">
            What is GLEAM?
          </a>
        </div>
        <LeaveControl runtime={runtime} wallet={wallet} points={formatPoints(standing.estimateAtomic)} />
      </footer>
    </div>
  );
}

function LeaveControl({ runtime, wallet, points }: { runtime: RuntimePort; wallet: WalletSummary; points: string }) {
  const leave = useLeavePoints(runtime);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-label text-faint hover:text-muted">
        Leave Gleam Points
      </button>
    );
  }

  return (
    <div role="alertdialog" aria-label="Leave Gleam Points" className="flex w-full flex-col gap-3 rounded-lg border border-line p-4">
      <p className="text-label text-foreground">
        You'll lose your {points} points and your invite link will stop working. This can't be undone.
      </p>
      {leave.error instanceof Error ? <p className="text-caption text-warning">{leave.error.message}</p> : null}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => setConfirming(false)}>
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
    </div>
  );
}
