import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  INVITE_REQUIRED_MESSAGE,
  isHardwareWalletMethod,
  type PointsMembership,
  type RuntimePort,
  type ScanAttestationApprovalPreview,
  type WalletState,
  type WalletSummary,
} from "@gleam/core";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { FoundingGate } from "@/entrypoints/popup/onboarding/src/FoundingGate";
import { JoinNote } from "@/entrypoints/popup/points/src/JoinNote";
import { formatPoints } from "@/entrypoints/popup/points/src/formatPoints";
import { useJoinPoints, usePendingInvite } from "@/entrypoints/popup/points/src/usePoints";

/**
 * A community scan attestation from the Gleam site (SCANS.md). Every
 * field was written by someone's agent and reached Gleam through a link,
 * so all of it renders as plain text, the report included: never as
 * markdown or HTML. Scan points go to the wallet that signs, so a wallet
 * that hasn't joined Gleam Points is offered the join first.
 */
export interface ScanAttestationScreenProps {
  runtime: RuntimePort;
  origin: string;
  preview: ScanAttestationApprovalPreview;
  onReject: () => void;
  /**
   * Never rejects: the window moves on to the result, the device step, or
   * the final error, since a failed request is already dropped.
   */
  onSign: () => Promise<void>;
}

export function ScanAttestationScreen(props: ScanAttestationScreenProps) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <ScanAttestationFlow {...props} />
    </QueryClientProvider>
  );
}

type Membership =
  | { status: "loading" }
  | { status: "joined"; wallet: WalletSummary | null }
  | { status: "not-joined"; wallet: WalletSummary | null }
  | { status: "error"; message: string };

function ScanAttestationFlow({ runtime, origin, preview, onReject, onSign }: ScanAttestationScreenProps) {
  const [membership, setMembership] = useState<Membership>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      runtime.send<void, Record<string, PointsMembership>>({ type: "getPointsMemberships", payload: undefined }),
      runtime.send<void, WalletState>({ type: "getState", payload: undefined }),
    ])
      .then(([memberships, state]) => {
        if (cancelled) return;
        const wallet = state.wallets.find((candidate) => candidate.id === preview.walletId) ?? null;
        setMembership({ status: memberships[preview.walletId] ? "joined" : "not-joined", wallet });
      })
      .catch((error: unknown) => {
        if (!cancelled) setMembership({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, preview.walletId]);

  return (
    <div className="flex min-h-full flex-col">
      <OriginHeader origin={origin} />
      {membership.status === "loading" ? (
        <p className="p-6 text-center text-sm text-muted">Loading…</p>
      ) : membership.status === "error" ? (
        <p role="alert" className="p-6 text-center text-sm text-warning">
          {membership.message}
        </p>
      ) : membership.status === "not-joined" ? (
        <JoinFirst
          runtime={runtime}
          walletId={preview.walletId}
          onJoined={() => setMembership({ status: "joined", wallet: membership.wallet })}
          onCancel={onReject}
        />
      ) : (
        <AttestationReview preview={preview} wallet={membership.wallet} onReject={onReject} onSign={onSign} />
      )}
    </div>
  );
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function OriginHeader({ origin }: { origin: string }) {
  const host = hostnameOf(origin);
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
      <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md border border-line bg-mist text-[10px] font-bold text-muted">
        {host.charAt(0).toUpperCase()}
      </div>
      <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground">{host}</span>
    </div>
  );
}

/** The claim step's join, reused: same call, same invite handling, same disclosure. */
function JoinFirst({
  runtime,
  walletId,
  onJoined,
  onCancel,
}: {
  runtime: RuntimePort;
  walletId: string;
  onJoined: () => void;
  onCancel: () => void;
}) {
  const join = useJoinPoints(runtime);
  const pending = usePendingInvite(runtime);

  if (join.error instanceof Error && join.error.message === INVITE_REQUIRED_MESSAGE) {
    return (
      <FoundingGate
        runtime={runtime}
        initialUnlock={null}
        onUnlocked={() => join.mutate({ walletId }, { onSuccess: onJoined })}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 pb-6 pt-6">
      <h1 className="text-center text-body font-bold text-foreground">Join Gleam Points to sign</h1>
      <p className="text-center text-label leading-relaxed text-muted">
        Scan points go to the wallet that signs the attestation, and this wallet isn&apos;t in Gleam Points yet. Join,
        then review the attestation here.
      </p>
      {pending.data ? (
        <p className="text-center text-caption text-muted">
          Invite code <span className="font-mono tracking-[0.08em] text-foreground">{pending.data}</span> will be applied.
        </p>
      ) : null}

      <div className="mt-auto flex flex-col gap-3 pt-2">
        {join.error instanceof Error ? (
          <p role="alert" className="text-center text-caption text-warning">
            {join.error.message}
          </p>
        ) : null}
        <Button disabled={join.isPending} onClick={() => join.mutate({ walletId }, { onSuccess: onJoined })}>
          {join.isPending ? "Joining…" : "Join Gleam Points"}
        </Button>
        <Button variant="secondary" disabled={join.isPending} onClick={onCancel}>
          Cancel
        </Button>
        <JoinNote />
      </div>
    </div>
  );
}

const RESULT_COPY: Record<ScanAttestationApprovalPreview["result"], string> = {
  pass: "Pass: the agent filed nothing",
  scanned: "Scanned: the agent filed a fix or an advisory",
};

function AttestationReview({
  preview,
  wallet,
  onReject,
  onSign,
}: {
  preview: ScanAttestationApprovalPreview;
  wallet: WalletSummary | null;
  onReject: () => void;
  onSign: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleSign = () => {
    setSubmitting(true);
    void onSign();
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4.5">
      <div className="text-center text-body font-bold text-foreground">Sign scan attestation</div>
      <p className="text-center text-label leading-relaxed text-muted">
        You vouch that your agent scanned Gleam v{preview.release} as described below.{" "}
        {wallet && isHardwareWalletMethod(wallet.method)
          ? "Your device signs a 0 AR proof of ownership that is never posted. It moves no funds."
          : "This signs no transaction and moves no funds."}
      </p>

      <Field label="Signing wallet">
        {wallet ? <span className="text-label font-semibold text-foreground">{wallet.name}</span> : null}
        <span className="break-all font-mono text-caption text-foreground">{preview.address}</span>
      </Field>

      <div className="flex flex-col">
        <Row label="Release" value={`v${preview.release}`} />
        <Row label="Model" value={preview.model} />
        <Row label="Result" value={RESULT_COPY[preview.result]} />
      </div>

      <Field label="Commit">
        <span className="break-all font-mono text-caption text-foreground">{preview.commit}</span>
      </Field>

      <Field label="Challenge answers">
        <ol className="flex flex-col gap-2">
          {preview.answers.map((answer, index) => (
            <li key={index} className="flex flex-col gap-0.5 rounded-md border border-line p-2.5">
              <span className="break-all font-mono text-[11px] text-foreground">
                {answer.file}:{answer.line}
              </span>
              <span className="break-all font-mono text-[11px] text-muted">{answer.symbol}</span>
              <span className="break-words text-caption text-foreground">{answer.check}</span>
            </li>
          ))}
        </ol>
      </Field>

      <Field label="Report">
        <div
          data-testid="attestation-report"
          className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-mist p-3 font-mono text-caption leading-relaxed text-foreground"
        >
          {preview.report}
        </div>
      </Field>

      <Field label="Attestation id">
        <span className="break-all font-mono text-[11px] text-foreground">{preview.attestationId}</span>
      </Field>

      <div className="mt-auto flex gap-2.5 pt-1">
        <Button type="button" variant="secondary" disabled={submitting} onClick={onReject} className="flex-1">
          Reject
        </Button>
        <Button
          type="button"
          disabled={submitting}
          aria-busy={submitting}
          onClick={handleSign}
          className="flex-1"
        >
          {submitting ? "Signing…" : "Sign"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 text-label last:border-b-0">
      <span className="flex-shrink-0 text-muted">{label}</span>
      <span className="min-w-0 break-words text-right font-semibold text-foreground">{value}</span>
    </div>
  );
}

/** What the window shows once the points API has answered. */
export function ScanAttestationResult({ result, onClose }: { result: SiteAttestResponse; onClose: () => void }) {
  let content: ReactNode;
  if (!result.ok) {
    content = (
      <>
        <h1 className="text-body font-bold text-foreground">Attestation not recorded</h1>
        <p role="alert" className="text-label leading-relaxed text-warning">
          {result.error}
        </p>
      </>
    );
  } else if (result.paid) {
    content = (
      <>
        <p className="text-[28px] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
          +{formatPoints(result.points)} points
        </p>
        <p className="text-label leading-relaxed text-muted">
          Your attestation is recorded. Points for a finding arrive when a maintainer accepts it.
        </p>
      </>
    );
  } else {
    content = (
      <>
        <h1 className="text-body font-bold text-foreground">Attestation recorded</h1>
        <p className="text-label leading-relaxed text-muted">
          {result.paidPlacesLeft === 0
            ? "This release's paid places were already taken, so this scan earned no points. Findings still pay when a maintainer accepts them."
            : "This scan earned no points because the first daily points snapshot hasn't run yet. Findings still pay when a maintainer accepts them."}
        </p>
      </>
    );
  }
  return (
    <div className="flex min-h-full flex-col items-center gap-3 px-6 pb-6 pt-12 text-center">
      {content}
      <div className="mt-auto w-full pt-6">
        <Button variant="secondary" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
