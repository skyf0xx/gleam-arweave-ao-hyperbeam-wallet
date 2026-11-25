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
import type { AttestationCheck } from "@gleam/messaging/src/protocol.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { ArmingLabel } from "./ArmingLabel";
import { FoundingGate } from "../screens/onboarding/src/FoundingGate";
import { JoinNote } from "../screens/points/src/JoinNote";
import { formatPoints } from "../screens/points/src/formatPoints";
import { useJoinPoints, usePendingInvite } from "../screens/points/src/usePoints";
import { useT, type MessageKey } from "../i18n";
import { errorText } from "../i18n/errors";
import { RequestHeader } from "../transfer-review/RequestHeader";
import { Field } from "../transfer-review/FieldLabel";

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
  /** The points API's dry run, asked before the signature so a stale scan fails before the device is involved. */
  onCheck: () => Promise<AttestationCheck>;
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

function ScanAttestationFlow({ runtime, origin, preview, onReject, onCheck, onSign }: ScanAttestationScreenProps) {
  const t = useT();
  const [membership, setMembership] = useState<Membership>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      runtime.send<void, Record<string, PointsMembership>>({ type: "getPointsMemberships", payload: undefined }),
      runtime.send<{ recordActivity: boolean }, WalletState>({ type: "getState", payload: { recordActivity: false } }),
    ])
      .then(([memberships, state]) => {
        if (cancelled) return;
        const wallet = state.wallets.find((candidate) => candidate.id === preview.walletId) ?? null;
        setMembership({ status: memberships[preview.walletId] ? "joined" : "not-joined", wallet });
      })
      .catch((error: unknown) => {
        if (!cancelled) setMembership({ status: "error", message: errorText(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, preview.walletId]);

  return (
    <div className="flex min-h-full flex-col">
      <RequestHeader
        origin={origin}
        requestType={
          membership.status === "joined"
            ? t("approval.signAttestation")
            : membership.status === "not-joined"
              ? t("approval.joinToSign")
              : t("approval.approvalRequest")
        }
      />
      {membership.status === "loading" ? (
        <p className="p-6 text-center text-sm text-muted">{t("approval.loading")}</p>
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
        <AttestationReview preview={preview} wallet={membership.wallet} onReject={onReject} onCheck={onCheck} onSign={onSign} />
      )}
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
  const t = useT();
  const join = useJoinPoints(runtime);
  const pending = usePendingInvite(runtime);
  // A callback passed to `mutate` is dropped when the click lands before the
  // mutation observer subscribes; the `mutateAsync` promise always settles.
  // A failure shows through `join.error`.
  const joinThenReview = () => join.mutateAsync({ walletId }).then(onJoined, () => {});

  if (join.error instanceof Error && join.error.message === INVITE_REQUIRED_MESSAGE) {
    return (
      <FoundingGate
        runtime={runtime}
        initialUnlock={null}
        onUnlocked={() => void joinThenReview()}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 pb-6 pt-6">
      <p className="text-center text-label leading-relaxed text-muted">
        {t("approval.joinExplain")}
      </p>
      {pending.data ? (
        <p className="text-center text-caption text-muted">
          {t("approval.inviteCodeBefore")}{" "}
          <span className="font-mono tracking-[0.08em] text-foreground">{pending.data}</span>{" "}
          {t("approval.inviteCodeAfter")}
        </p>
      ) : null}

      <div className="mt-auto flex flex-col gap-3 pt-2">
        {join.error instanceof Error ? (
          <InlineError className="text-center">
            {errorText(join.error)}
          </InlineError>
        ) : null}
        <Button disabled={join.isPending} onClick={() => void joinThenReview()}>
          {join.isPending ? t("approval.joining") : t("approval.joinPoints")}
        </Button>
        <Button variant="secondary" disabled={join.isPending} onClick={onCancel}>
          {t("approval.cancel")}
        </Button>
        <JoinNote />
      </div>
    </div>
  );
}

const RESULT_COPY: Record<ScanAttestationApprovalPreview["result"], MessageKey> = {
  pass: "approval.resultPass",
  scanned: "approval.resultScanned",
};

function AttestationReview({
  preview,
  wallet,
  onReject,
  onCheck,
  onSign,
}: {
  preview: ScanAttestationApprovalPreview;
  wallet: WalletSummary | null;
  onReject: () => void;
  onCheck: () => Promise<AttestationCheck>;
  onSign: () => Promise<void>;
}) {
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const [checkError, setCheckError] = useState<string>();

  const handleSign = async () => {
    setSubmitting(true);
    setCheckError(undefined);
    let check: AttestationCheck;
    try {
      check = await onCheck();
    } catch (error) {
      check = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!check.ok) {
      setCheckError(errorText(check.error));
      setSubmitting(false);
      return;
    }
    void onSign();
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4.5">
      <p className="text-center text-label leading-relaxed text-muted">
        {t(
          wallet && isHardwareWalletMethod(wallet.method) ? "approval.attestIntroDevice" : "approval.attestIntroMessage",
          { release: preview.release },
        )}
      </p>

      <Field label={t("approval.signingWallet")}>
        {wallet ? <span className="text-label font-semibold text-foreground">{wallet.name}</span> : null}
        <span className="break-all font-mono text-caption text-foreground">{preview.address}</span>
      </Field>

      <div className="flex flex-col">
        <Row label={t("approval.release")} value={`v${preview.release}`} />
        <Row label={t("approval.model")} value={preview.model} />
        <Row label={t("approval.result")} value={t(RESULT_COPY[preview.result])} />
      </div>

      <Field label={t("approval.commit")}>
        <span className="break-all font-mono text-caption text-foreground">{preview.commit}</span>
      </Field>

      <Field label={t("approval.challengeAnswers")}>
        <ol className="flex flex-col gap-2">
          {preview.answers.map((answer, index) => (
            <li key={index} className="flex flex-col gap-0.5 rounded-md border border-line p-2.5">
              <span className="break-all font-mono text-caption text-foreground">
                {answer.file}:{answer.line}
              </span>
              <span className="break-all font-mono text-caption text-muted">{answer.symbol}</span>
              <span className="break-words text-caption text-foreground">{answer.check}</span>
            </li>
          ))}
        </ol>
      </Field>

      <Field label={t("approval.report")}>
        <div
          data-testid="attestation-report"
          className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-mist p-3 font-mono text-caption leading-relaxed text-foreground"
        >
          {preview.report}
        </div>
      </Field>

      <Field label={t("approval.attestationId")}>
        <span className="break-all font-mono text-caption text-foreground">{preview.attestationId}</span>
      </Field>

      {checkError ? (
        <p role="alert" className="text-center text-label leading-relaxed text-warning">
          {checkError}
        </p>
      ) : null}

      <div className="mt-auto flex gap-2.5 pt-1">
        <Button type="button" variant="secondary" disabled={submitting} onClick={onReject} className="flex-1">
          {t("approval.reject")}
        </Button>
        <Button
          type="button"
          disabled={submitting}
          aria-busy={submitting}
          onClick={() => void handleSign()}
          className="flex-1"
        >
          {submitting ? t("approval.signing") : <ArmingLabel>{t("approval.sign")}</ArmingLabel>}
        </Button>
      </div>
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
  const t = useT();
  let content: ReactNode;
  if (!result.ok) {
    content = (
      <>
        <h1 className="text-body font-bold text-foreground">{t("approval.attestationNotRecorded")}</h1>
        <p role="alert" className="text-label leading-relaxed text-warning">
          {result.error}
        </p>
      </>
    );
  } else if (result.paid) {
    content = (
      <>
        <p className="text-display-sm font-semibold tracking-[-0.02em] tabular-nums text-foreground">
          {t("approval.pointsEarned", { points: formatPoints(result.points) })}
        </p>
        <p className="text-label leading-relaxed text-muted">
          {t("approval.attestationRecordedPaid")}
        </p>
      </>
    );
  } else {
    content = (
      <>
        <h1 className="text-body font-bold text-foreground">{t("approval.attestationRecorded")}</h1>
        <p className="text-label leading-relaxed text-muted">
          {result.unpaidReason === "places_taken"
            ? t("approval.unpaidPlacesTaken")
            : result.unpaidReason === "no_snapshot"
              ? t("approval.unpaidNoSnapshot")
              : t("approval.unpaidOther")}
        </p>
      </>
    );
  }
  return (
    <div className="flex min-h-full flex-col items-center gap-3 px-6 pb-6 pt-12 text-center">
      {content}
      <div className="mt-auto w-full pt-6">
        <Button variant="secondary" className="w-full" onClick={onClose}>
          {t("approval.close")}
        </Button>
      </div>
    </div>
  );
}
