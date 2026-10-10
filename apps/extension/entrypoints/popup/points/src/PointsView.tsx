import { useState, type ReactNode } from "react";
import { browser } from "wxt/browser";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { inviteLinkFor, invitePost, invitesLine, xIntentUrl } from "@/src/points-share";
import { sitePageUrl } from "@/src/site-pages";
import { HOW_IT_WORKS_URL, JoinNote } from "./JoinNote";
import { ShareCard } from "./ShareCard";
import { SharePrompt } from "./SharePrompt";
import { formatPoints } from "./formatPoints";
import { useCopy } from "./useCopy";
import { useJoinPoints, useLeavePoints, usePendingInvite, usePointsStanding } from "./usePoints";

export interface PointsViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
  /** Replaces the share prompt at the top of the Invite section. */
  banner?: ReactNode;
}

const NOTE_TEXT =
  "Your early moves count. We're exploring how points could connect to future Gleam benefits. Their eventual utility, if any, hasn't been finalised.";

function FutureLink({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <a
      href={sitePageUrl("future", browser.runtime.getManifest().version)}
      target="_blank"
      rel="noreferrer"
      className={className ?? "text-label text-muted underline hover:text-foreground"}
    >
      {children}
    </a>
  );
}

export function PointsView({ runtime, wallet, onBack, banner }: PointsViewProps) {
  const standing = usePointsStanding(runtime, wallet);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Gleam Points" onBack={onBack} />
      {standing.status === "joined" ? (
        <JoinedView runtime={runtime} wallet={wallet} standing={standing} banner={banner} />
      ) : standing.status === "not-joined" ? (
        <JoinView runtime={runtime} wallet={wallet} />
      ) : null}
    </div>
  );
}

function JoinView({ runtime, wallet }: { runtime: RuntimePort; wallet: WalletSummary }) {
  const join = useJoinPoints(runtime);
  const pending = usePendingInvite(runtime);
  const [typed, setTyped] = useState<string | null>(null);
  const inviteCode = typed ?? pending.data ?? "";

  return (
    <form
      className="flex flex-1 flex-col gap-5 px-6 pb-6 pt-7"
      onSubmit={(event) => {
        event.preventDefault();
        join.mutate({ walletId: wallet.id, inviteCode: inviteCode.trim() || undefined });
      }}
    >
      <div className="flex flex-col gap-2">
        <p className="text-body text-muted">
          Earn points every day for the AR and AO you hold. Invite friends and you both earn more.
        </p>
        <FutureLink>What could points become?</FutureLink>
      </div>

      <TextField
        label="Invite code"
        placeholder="Paste a code if you have one to earn extra points"
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

function JoinedView({
  runtime,
  wallet,
  standing,
  banner,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  standing: Extract<ReturnType<typeof usePointsStanding>, { status: "joined" }>;
  banner?: ReactNode;
}) {
  const { score } = standing;
  const inviteLink = inviteLinkFor(standing.membership.inviteCode);
  const { copied, copy } = useCopy(inviteLink);
  const seatsLeft = score?.seatsLeft ?? null;
  const shareHref = xIntentUrl(invitePost({ seats: seatsLeft, link: inviteLink }));

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 pb-6 pt-7">
      <section aria-label="Standing" className="flex flex-col items-center gap-1 text-center">
        <span className="text-h2 font-semibold tabular-nums text-foreground">{formatPoints(standing.estimateAtomic)}</span>
        {score?.foundingNumber != null ? (
          <span className="text-label font-semibold text-foreground">Founding member #{score.foundingNumber}</span>
        ) : null}
        {score?.originalFounder ? <span className="text-label text-muted">Original founder · +10%</span> : null}
        <span className="text-label text-muted">
          {score?.topPercent != null ? `Top ${score.topPercent}%` : "Your rank appears after the next daily snapshot"}
        </span>
      </section>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
        <div className="flex flex-col gap-0.5 bg-background px-3 py-3">
          <dt className="text-caption text-faint">Today&apos;s rate</dt>
          <dd className="text-body tabular-nums text-foreground">{formatPoints(standing.dailyRateAtomic)}</dd>
        </div>
        <div className="flex flex-col gap-0.5 bg-background px-3 py-3">
          <dt className="text-caption text-faint">Friends joined</dt>
          <dd className="text-body tabular-nums text-foreground">{score?.refereeCount ?? 0}</dd>
        </div>
        <div className="flex flex-col gap-0.5 bg-background px-3 py-3">
          <dt className="text-caption text-faint">Invites left</dt>
          <dd className="min-h-6 text-body tabular-nums text-foreground">{seatsLeft}</dd>
        </div>
      </dl>

      <section aria-label="Invite" className="flex flex-col gap-3">
        {banner ?? (
          <SharePrompt runtime={runtime} wallet={wallet} inviteCode={standing.membership.inviteCode} score={score} />
        )}
        {seatsLeft !== null ? <h2 className="text-h3 font-semibold text-foreground">{invitesLine(seatsLeft)}</h2> : null}
        {score?.foundingNumber != null ? <ShareCard foundingNumber={score.foundingNumber} seatsLeft={seatsLeft} /> : null}
        <Button asChild>
          <a href={shareHref} target="_blank" rel="noreferrer">
            Share on X
          </a>
        </Button>
        <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-label text-foreground">{inviteLink}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={copy}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-caption text-faint">
          A friend who installs Gleam from your link and joins earns 10% extra, and you earn 10% of their points.
        </p>
      </section>

      <section aria-label="Where points are going" className="flex flex-col gap-1">
        <h2 className="text-label font-semibold text-muted">Where points are going</h2>
        <p className="text-caption text-faint">{NOTE_TEXT}</p>
        <FutureLink className="text-caption text-muted underline hover:text-foreground">What could points become?</FutureLink>
      </section>

      <footer className="mt-auto flex flex-col items-center gap-3">
        <a
          href={HOW_IT_WORKS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-label text-muted underline hover:text-foreground"
        >
          How points work
        </a>
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
