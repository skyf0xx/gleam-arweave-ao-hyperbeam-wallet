import type {
  ApprovalRequest,
  DeviceSigningRequest,
  RecipientAssessment,
  RuntimePort,
  WalletState,
  WalletSummary,
} from "@gleam/core";
import type { ApprovalShown } from "@gleam/messaging/src/protocol.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import { recipientsOf, transferRequestFromPreview } from "../transfer-review/model";

export type LoadState =
  | { kind: "loading" }
  | { kind: "no-wallet"; runtime: RuntimePort; request: ApprovalRequest }
  | { kind: "locked"; runtime: RuntimePort; request: ApprovalRequest }
  | {
      kind: "ready";
      runtime: RuntimePort;
      request: ApprovalRequest;
      assessment: RecipientAssessment | null;
      wallet: WalletSummary | null;
    }
  | {
      kind: "awaiting-device";
      runtime: RuntimePort;
      request: ApprovalRequest;
      device: DeviceSigningRequest;
      wallet: WalletSummary | null;
    }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string }
  | { kind: "attested"; result: SiteAttestResponse }
  | { kind: "failed"; message: string };

export function isShown(value: unknown): value is ApprovalShown {
  return typeof value === "object" && value !== null && (value as { shown?: unknown }).shown === "scanAttestation";
}

/**
 * The wallet that must be unlocked: the one a scan attestation was opened
 * for, which stays its signer even if the user switches wallets, or else
 * the wallet the request signs or sends from, pinned when it was made —
 * the active wallet can be a different one by the time the window loads.
 * Unlock opens every wallet that shares the vault password.
 */
export function needsUnlock(state: WalletState, request: ApprovalRequest): boolean {
  const unlocked = state.session?.unlockedWalletIds ?? [];
  const walletId =
    request.preview.kind === "scanAttestation"
      ? request.preview.walletId
      : (request.signingWallet?.id ?? state.activeWalletId);
  if (walletId === null) return unlocked.length === 0;
  return !unlocked.includes(walletId);
}

/**
 * Checks every recipient the request pays, a data item's transfer
 * included, and folds them into one: a batch warns if any recipient is
 * new or a lookalike. Best effort: a failed lookup returns `null`, and the
 * screen then warns without naming a reason.
 */
export async function assessRecipientFor(
  runtime: RuntimePort,
  request: ApprovalRequest,
  walletId: string | null,
): Promise<RecipientAssessment | null> {
  const preview = request.preview;
  if (preview.kind === "connect" || preview.kind === "addToken" || preview.kind === "scanAttestation") return null;
  const transfer = transferRequestFromPreview(preview);
  if (!transfer || !walletId) return null;
  try {
    const recipients = recipientsOf(transfer);
    const assessments = await Promise.all(
      recipients.map((recipient) =>
        runtime.send<{ walletId: string; recipient: string }, RecipientAssessment | undefined>({
          type: "assessRecipient",
          payload: { walletId, recipient },
        }),
      ),
    );
    if (assessments.some((assessment) => !assessment)) return null;
    const lookalikeIndex = assessments.findIndex((assessment) => assessment!.lookalikeOf);
    return {
      firstTime: assessments.some((assessment) => assessment!.firstTime),
      lookalikeOf: lookalikeIndex >= 0 ? assessments[lookalikeIndex]!.lookalikeOf : null,
      // The warning names the known address and compares it against the
      // recipient that was flagged for it, so the fold keeps that recipient
      // alongside the address it resembles.
      lookalikeRecipient: lookalikeIndex >= 0 ? recipients[lookalikeIndex]! : null,
    };
  } catch {
    return null;
  }
}

/** The tokens a request moves, for the balances and prices its review reads. */
export function tokensOf(request: ApprovalRequest): Array<string | null> {
  const preview = request.preview;
  if (preview.kind === "connect" || preview.kind === "addToken" || preview.kind === "scanAttestation") return [];
  const transfer = transferRequestFromPreview(preview);
  if (transfer) return transfer.transfers.filter((line) => !line.collectible).map((line) => line.token);
  return request.device ? [preview.token] : [];
}
