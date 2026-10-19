import { capabilitiesFor, type WalletSummary } from "@gleam/core";
import { parseAttestation, type ParsedAttestation } from "@gleam/core/src/scan/attestation.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import type { SiteMessage } from "./dispatch/methods";
import { attestFailure } from "./handlers/attest-errors";
import { ApprovalDeclinedError } from "./handlers/approval";
import { SITE_ORIGIN } from "./site-pages";

export interface SiteAttestationDeps {
  /** The wallet that would sign: the active one, or null if Gleam has none. */
  activeWallet: () => Promise<WalletSummary | null>;
  /** Opens the approval window and resolves with the points API's verdict. */
  requestScanAttestation: (req: {
    origin: string;
    walletId: string;
    address: string;
    attestation: ParsedAttestation;
  }) => Promise<SiteAttestResponse>;
}

/**
 * Handles `attest.html` handing over a community scan attestation
 * (SCANS.md § The attestation), once `dispatchSiteMessage` has checked
 * its origin and shape. The attestation is parsed with the same core
 * parser the CLI and the points API use, so nothing the parser refuses
 * reaches a window. The reply always says what happened, so the page can
 * show it.
 */
export async function signSiteAttestation(
  request: SiteMessage<"gleam-points:attest">,
  deps: SiteAttestationDeps,
): Promise<SiteAttestResponse> {
  const parsed = parseAttestation(request.attestation);
  if (!parsed.ok) return attestFailure("invalid_attestation", "");
  const { release } = parsed.attestation;

  const wallet = await deps.activeWallet();
  if (!wallet) return attestFailure("no_wallet", release);
  if (!capabilitiesFor(wallet.method).points) return attestFailure("unsupported_wallet", release);

  try {
    return await deps.requestScanAttestation({
      origin: SITE_ORIGIN,
      walletId: wallet.id,
      address: wallet.address,
      attestation: parsed.attestation,
    });
  } catch (error) {
    if (error instanceof ApprovalDeclinedError) return attestFailure(error.timedOut ? "timed_out" : "rejected", release);
    return attestFailure("signing_failed", release, error instanceof Error ? error.message : String(error));
  }
}
