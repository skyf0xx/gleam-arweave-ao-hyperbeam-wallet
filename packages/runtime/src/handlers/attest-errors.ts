import type { SiteAttestErrorCode, SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";

const NEW_SCAN = "ask your agent to run `pnpm scan start` and finish a new scan";

/**
 * What Gleam's window and `attest.html` say for each failure: what went
 * wrong and what to do next, in one sentence. The points API's own
 * messages are written for the agent running the CLI, so they aren't
 * shown to the person signing.
 */
function sentence(code: SiteAttestErrorCode, release: string, detail?: string): string {
  switch (code) {
    case "refused":
      return "Gleam ignored a request it doesn't recognise. Open the link `pnpm scan finish` printed.";
    case "invalid_attestation":
    case "malformed_request":
      return "This attestation isn't valid, so it wasn't signed. Ask your agent to run `pnpm scan finish` and send the new link.";
    case "no_wallet":
      return "Gleam has no wallet yet. Create one, join Gleam Points, then open the link again.";
    case "unsupported_wallet":
      return "This wallet can't sign for Gleam Points. Switch to another wallet in Gleam, then open the link again.";
    case "busy":
      return "Gleam is already showing an attestation to sign. Finish or close that window, then open the link again.";
    case "rejected":
      return "You didn't sign the attestation. Open the link again when you're ready to sign it.";
    case "timed_out":
      return "The signing window timed out. Open the link again to sign.";
    case "signing_failed":
      return `Gleam couldn't sign the attestation${detail ? `: ${detail.replace(/\.$/, "")}` : ""}. Try again from the link.`;
    case "offline":
      return "Gleam couldn't reach the points server. Check your connection, then open the link again.";
    case "message_mismatch":
    case "invalid_signature":
      return "The points server didn't accept the signature. Open the link again to sign, and report it if this repeats.";
    case "wallet_not_registered":
      return "This wallet isn't in Gleam Points. Join from Gleam's Points screen, then open the link again.";
    case "wallet_not_live":
      return "Gleam hasn't checked in for this wallet in the last 3 days. Open Gleam's popup, wait a minute, then open the link again.";
    case "no_release":
      return "Gleam hasn't published a release to scan yet. Try again once one is out.";
    case "unknown_release":
      return "The points server doesn't know this release. Ask your agent to scan the latest release.";
    case "release_not_latest":
      return `v${release} is no longer the latest release, so this scan can't be signed. Ask your agent to scan the latest release.`;
    case "commit_mismatch":
      return `The scanned commit isn't v${release}'s tag. Ask your agent to check out the tag and run \`pnpm scan finish\` again.`;
    case "challenge_unknown":
    case "challenge_wrong_release":
    case "challenge_wrong_commit":
      return `The scan's challenge doesn't match v${release}. To start over, ${NEW_SCAN}.`;
    case "challenge_expired":
      return `The scan's challenge expired after 24 hours. To start over, ${NEW_SCAN}.`;
    case "challenge_used":
      return `The scan's challenge was already used. To start over, ${NEW_SCAN}.`;
    case "answers_failed":
      return "The challenge answers didn't pass the check. Ask your agent to run `pnpm scan finish` and fix what it reports.";
    case "already_attested":
      return `This wallet already attested v${release}, and each wallet attests a release once. Scan again when the next release is out.`;
    case "rate_limited":
      return "Too many attestations came from this network. Wait an hour, then open the link again.";
    case "github_unavailable":
    case "challenge_unavailable":
      return "The points server couldn't check the release just now. Open the link again in a minute.";
    case "server_error":
      return `The points server refused the attestation${detail ? `: ${detail.replace(/\.$/, "")}` : ""}. Open the link again later.`;
  }
}

export function attestFailure(code: SiteAttestErrorCode, release: string, detail?: string): SiteAttestResponse {
  return { ok: false, code, error: sentence(code, release, detail) };
}

const SERVER_CODES: ReadonlySet<string> = new Set<SiteAttestErrorCode>([
  "malformed_request",
  "invalid_attestation",
  "message_mismatch",
  "invalid_signature",
  "wallet_not_registered",
  "wallet_not_live",
  "no_release",
  "unknown_release",
  "release_not_latest",
  "commit_mismatch",
  "challenge_unknown",
  "challenge_wrong_release",
  "challenge_wrong_commit",
  "challenge_expired",
  "challenge_used",
  "answers_failed",
  "already_attested",
  "rate_limited",
  "github_unavailable",
  "challenge_unavailable",
]);

/** A refusal from `POST /attestations`, by its `code`; an unknown one keeps the server's own sentence. */
export function serverAttestFailure(status: number, body: { code?: unknown; error?: unknown } | null, release: string): SiteAttestResponse {
  const code = typeof body?.code === "string" ? body.code : null;
  if (code !== null && SERVER_CODES.has(code)) return attestFailure(code as SiteAttestErrorCode, release);
  if (status === 429) return attestFailure("rate_limited", release);
  if (status === 413) return attestFailure("invalid_attestation", release);
  return attestFailure("server_error", release, typeof body?.error === "string" ? body.error : `HTTP ${status}`);
}
