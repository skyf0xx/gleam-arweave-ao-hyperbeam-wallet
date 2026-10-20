/**
 * Messages the Gleam site sends the extension with
 * `chrome.runtime.sendMessage(EXTENSION_ID, message, callback)`, and the
 * replies it gets. Chrome delivers them only from the manifest's
 * `externally_connectable` origin, and the background also checks
 * `sender.origin` against the site before it reads the message.
 */

export const SITE_ATTEST_MESSAGE_TYPE = "gleam-points:attest";
export const SITE_ATTEST_STATUS_MESSAGE_TYPE = "gleam-points:attest-status";

/**
 * `attest.html` hands over the attestation decoded from its link
 * (SCANS.md § The attestation). The extension parses it again with
 * `parseAttestation`, so the page needs no checks of its own. No other
 * key is allowed.
 */
export interface SiteAttestRequest {
  type: typeof SITE_ATTEST_MESSAGE_TYPE;
  attestation: unknown;
}

/**
 * Why an attestation wasn't recorded. Codes from the points API pass
 * through unchanged; the rest come from the extension.
 */
export type SiteAttestErrorCode =
  // The extension, before anything is signed.
  /** Not a `SiteAttestRequest`, or not from the site's origin. */
  | "refused"
  /** `parseAttestation` rejected the attestation; the link is broken or edited. */
  | "invalid_attestation"
  /** Gleam has no wallet yet. */
  | "no_wallet"
  /** The active wallet's kind can't sign Gleam Points messages. */
  | "unsupported_wallet"
  /** Another attestation is already waiting in Gleam's window; that one is focused instead. */
  | "busy"
  /** The user rejected the request or closed the window. */
  | "rejected"
  /** The window was left open past the approval timeout. */
  | "timed_out"
  /** Signing failed in the extension (wallet locked, device error). `error` says why. */
  | "signing_failed"
  /** The points API couldn't be reached, or answered with something unreadable. */
  | "offline"
  // The points API (POINTS.md § Server, scan endpoint codes).
  | "malformed_request"
  | "message_mismatch"
  | "invalid_signature"
  | "wallet_not_registered"
  | "wallet_not_live"
  | "no_release"
  | "unknown_release"
  | "release_not_latest"
  | "commit_mismatch"
  | "challenge_unknown"
  | "challenge_wrong_release"
  | "challenge_wrong_commit"
  | "challenge_expired"
  | "challenge_used"
  | "answers_failed"
  | "already_attested"
  | "rate_limited"
  | "github_unavailable"
  | "challenge_unavailable"
  /** Any other refusal from the points API. */
  | "server_error";

/**
 * The reply `attest.html` gets once the user has finished in Gleam's
 * window. `points` is atomic (12 decimals, POINTS.md § Rules); it is "0"
 * with `paid: false` when the release's paid places were already taken or
 * no snapshot day exists yet, and the attestation is still recorded.
 * `error` is one sentence with a next step, the same one Gleam's window
 * shows.
 */
export type SiteAttestResponse =
  | {
      ok: true;
      attestationId: string;
      points: string;
      paid: boolean;
      /** Why `paid` is false; null when paid, or when the server didn't say. */
      unpaidReason: "places_taken" | "no_snapshot" | null;
      paidPlacesLeft: number;
    }
  | { ok: false; code: SiteAttestErrorCode; error: string };

/**
 * `attest.html` asks this on load, so its button can say the next step
 * (install, join Points, sign) before anyone clicks it. It opens no
 * window and says nothing about the wallet beyond whether it can sign.
 */
export interface SiteAttestStatusRequest {
  type: typeof SITE_ATTEST_STATUS_MESSAGE_TYPE;
}

/** The same check `gleam-points:attest` runs before it opens a window, without the attestation. */
export type SiteAttestStatusResponse =
  | { ok: true }
  | { ok: false; code: "no_wallet" | "unsupported_wallet" | "wallet_not_registered" };
