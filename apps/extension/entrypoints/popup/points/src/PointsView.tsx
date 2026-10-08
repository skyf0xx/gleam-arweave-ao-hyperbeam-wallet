import { useState } from "react";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { SITE_URL } from "@/src/site-pages";
import { formatPoints } from "./formatPoints";
import { useJoinPoints, usePointsStanding } from "./usePoints";

export interface PointsViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
}

export function inviteLinkFor(inviteCode: string): string {
  const url = new URL("invite.html", SITE_URL);
  url.searchParams.set("c", inviteCode);
  return url.toString();
}

const HOW_IT_WORKS_URL = new URL("points.html", SITE_URL).toString();

export function PointsView({ runtime, wallet, onBack }: PointsViewProps) {
  const standing = usePointsStanding(runtime, wallet);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Gleam Points" onBack={onBack} />
      {standing.status === "joined" ? (
        <JoinedView standing={standing} />
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
          {wallet.name} earns points every day for the AR and AO it holds. Invite friends and you both earn more.
        </p>
      </div>

      <TextField
        label="Invite code"
        hint="Optional"
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
        <p className="text-center text-caption text-faint">
          Joining links this wallet's address to this browser on the Gleam Points server.{" "}
          <a href={HOW_IT_WORKS_URL} target="_blank" rel="noreferrer" className="underline hover:text-muted">
            How points work
          </a>
        </p>
      </div>
    </form>
  );
}

function JoinedView({ standing }: { standing: Extract<ReturnType<typeof usePointsStanding>, { status: "joined" }> }) {
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

      <a
        href={HOW_IT_WORKS_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-auto text-center text-label text-muted underline hover:text-foreground"
      >
        How points work
      </a>
    </div>
  );
}
