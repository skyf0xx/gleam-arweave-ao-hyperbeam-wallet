import { useState } from "react";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { inviteLinkFor } from "@/src/points-share";
import { HOW_IT_WORKS_URL, JoinNote } from "./JoinNote";
import { formatPoints } from "./formatPoints";
import { useJoinPoints, useLeavePoints, usePointsStanding } from "./usePoints";

export interface PointsViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
}

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

function JoinView({ runtime, wallet }: { runtime: RuntimePort; wallet: WalletSummary }) {
  const join = useJoinPoints(runtime);
  const [inviteCode, setInviteCode] = useState("");

  return (
    <form
      className="flex flex-1 flex-col gap-5 px-6 pb-6 pt-7"
      onSubmit={(event) => {
        event.preventDefault();
        join.mutate({ walletId: wallet.id, inviteCode: inviteCode.trim() || undefined });
      }}
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-h3 font-semibold text-foreground">Earn points for holding AR and AO</h2>
        <p className="text-body text-muted">
          Earn points every day for the AR and AO you hold. Invite friends and you both earn more.
        </p>
      </div>

      <TextField
        label="Invite code"
        placeholder="Paste a code if you have one to earn extra points"
        value={inviteCode}
        onChange={(event) => setInviteCode(event.target.value)}
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

function JoinedView({
  runtime,
  wallet,
  standing,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  standing: Extract<ReturnType<typeof usePointsStanding>, { status: "joined" }>;
}) {
  const [copied, setCopied] = useState(false);
  const inviteLink = inviteLinkFor(standing.membership.inviteCode);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 pb-6 pt-7">
      <div className="flex flex-col items-center gap-1">
        <span className="text-h2 font-semibold tabular-nums text-foreground">{formatPoints(standing.estimateAtomic)}</span>
        <span className="text-label text-muted">
          {standing.score?.topPercent != null
            ? `Top ${standing.score.topPercent}%`
            : "Your rank appears after the next daily snapshot"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
        <div className="flex flex-col gap-0.5 bg-background px-4 py-3">
          <dt className="text-caption text-faint">Earning</dt>
          <dd className="text-body tabular-nums text-foreground">{formatPoints(standing.dailyRateAtomic)} / day</dd>
        </div>
        <div className="flex flex-col gap-0.5 bg-background px-4 py-3">
          <dt className="text-caption text-faint">Friends joined</dt>
          <dd className="text-body tabular-nums text-foreground">{standing.score?.refereeCount ?? 0}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        <span className="text-label font-semibold text-muted">Your invite link</span>
        <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-label text-foreground">{inviteLink}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(inviteLink).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-caption text-faint">
          A friend who installs Gleam from your link and joins earns 10% extra, and you earn 10% of their points.
        </p>
      </div>

      <div className="mt-auto flex flex-col items-center gap-3">
        <a
          href={HOW_IT_WORKS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-label text-muted underline hover:text-foreground"
        >
          How points work
        </a>
        <LeaveControl runtime={runtime} wallet={wallet} points={formatPoints(standing.estimateAtomic)} />
      </div>
    </div>
  );
}

function LeaveControl({ runtime, wallet, points }: { runtime: RuntimePort; wallet: WalletSummary; points: string }) {
  const leave = useLeavePoints(runtime);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-caption text-faint hover:text-muted">
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
