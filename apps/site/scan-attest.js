/* global atob, TextDecoder */
// attest.html: the link's payload, and talking to the extension. The link is
// data: callers render what comes from it with textContent only.
import { EXTENSION_ID, ATTEST_MESSAGE_TYPE, ATTEST_STATUS_MESSAGE_TYPE, ID_PATTERN, RELEASE_PATTERN, SCAN_AREAS, formatPoints } from "./scan-lib.js";

const BAD_LINK = "This link isn't a Gleam attestation. Open the link your agent printed, unchanged.";
const TOO_MANY_ROUNDS = "This link has more rounds than a release has areas. Open the link your agent printed, unchanged.";
const DAMAGED_ROUND = "This round's part of the link is damaged, so it can't be signed.";

/**
 * Decodes `attest.html#<payload>`: base64url (no padding) of UTF-8 JSON, the
 * same steps as `decodeAttestationPayload` in packages/core/src/scan/payload.ts.
 * The extension runs its own full check before anything is signed, so this
 * only verifies what the page needs to show a summary.
 */
export function decodeAttestationFragment(hash) {
  const payload = hash.replace(/^#/, "");
  let value;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("not base64url");
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, error: BAD_LINK };
  }
  if (!isShowable(value)) return { ok: false, error: BAD_LINK };
  return { ok: true, attestation: value };
}

/**
 * Decodes `attest.html#<p1>.<p2>…`, one payload per round (`.` is outside the
 * base64url alphabet). A payload that doesn't decode is a damaged round, so
 * the rest can still be signed; the link fails as a whole only when it is
 * empty, malformed, carries more rounds than a release has areas, or has no
 * round that decodes. Settles with `{ ok: true, rounds }`, each round
 * `{ ok: true, payload, attestation }` or `{ ok: false, payload, error }`, or
 * with `{ ok: false, error }`.
 */
export function decodeAttestationLink(hash) {
  const parts = hash.replace(/^#/, "").split(".");
  if (parts.length > SCAN_AREAS.length) return { ok: false, error: TOO_MANY_ROUNDS };
  if (parts.some((part) => part === "")) return { ok: false, error: BAD_LINK };
  const rounds = parts.map((payload) => {
    const decoded = decodeAttestationFragment(payload);
    return decoded.ok ? { ok: true, payload, attestation: decoded.attestation } : { ok: false, payload, error: DAMAGED_ROUND };
  });
  if (!rounds.some((round) => round.ok)) return { ok: false, error: BAD_LINK };
  return { ok: true, rounds };
}

/** The app's attest link for one payload: the app takes one attestation per link. */
export function appAttestHref(payload) {
  return `https://open.gleamwallet.app/attest#${payload}`;
}

const SUMMARY_MAX = 90;

/**
 * A one-line label for a round: the report's first line that isn't a heading
 * (its "Area: …" line, as the skill writes it), without list or emphasis
 * marks; the model and result when the report has no such line.
 */
export function roundSummary(attestation) {
  for (const raw of attestation.report.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const line = trimmed.replace(/^(?:[-*+]|\d+\.)\s+/, "").replace(/\*\*|`/g, "").trim();
    if (line === "") continue;
    return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}\u2026` : line;
  }
  return `${attestation.model}, ${attestation.result}`;
}

/** The sum of atomic point amounts; anything that isn't one counts as 0. */
export function sumPoints(amounts) {
  let total = 0n;
  for (const amount of amounts) if (typeof amount === "string" && /^\d{1,40}$/.test(amount)) total += BigInt(amount);
  return total.toString();
}

function isShowable(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.release !== "string" || !RELEASE_PATTERN.test(value.release)) return false;
  for (const key of ["commit", "model", "challenge", "report"]) if (typeof value[key] !== "string") return false;
  if (value.result !== "pass" && value.result !== "scanned") return false;
  if (!Array.isArray(value.answers)) return false;
  return value.answers.every(
    (a) =>
      a !== null &&
      typeof a === "object" &&
      typeof a.file === "string" &&
      typeof a.symbol === "string" &&
      typeof a.check === "string" &&
      Number.isInteger(a.line),
  );
}

/**
 * Sends `message` to Gleam and settles with one of:
 * `{ kind: "no-extension" }`: Gleam isn't installed (or can't be reached from here);
 * `{ kind: "interrupted" }`: the extension went away mid-request (its service
 *   worker restarted, the port closed), so trying again is the right step;
 * `{ kind: "reply", reply }`: an object with a boolean `ok`.
 * It never rejects.
 */
function sendToGleam(runtime, message) {
  return new Promise((resolve) => {
    if (!runtime || typeof runtime.sendMessage !== "function") {
      resolve({ kind: "no-extension" });
      return;
    }
    try {
      runtime.sendMessage(EXTENSION_ID, message, (reply) => {
        const lastError = runtime.lastError;
        if (lastError) {
          const text = String((lastError && lastError.message) || "");
          // Chrome's wording when nothing is listening: not installed, disabled, or the wrong id.
          resolve(
            /receiving end does not exist|extension not found|invalid extension id|could not establish connection/i.test(text)
              ? { kind: "no-extension" }
              : { kind: "interrupted" },
          );
          return;
        }
        if (reply === null || typeof reply !== "object" || typeof reply.ok !== "boolean") {
          resolve({ kind: "interrupted" });
          return;
        }
        resolve({ kind: "reply", reply });
      });
    } catch {
      resolve({ kind: "no-extension" });
    }
  });
}

/** Sends the attestation to Gleam; the reply is a `SiteAttestResponse`. Settles as `sendToGleam` does. */
export function sendAttestation(runtime, attestation) {
  return sendToGleam(runtime, { type: ATTEST_MESSAGE_TYPE, attestation });
}

const READINESS_BY_CODE = { no_wallet: "no-wallet", unsupported_wallet: "unsupported", wallet_not_registered: "not-joined" };
const CHECK_TIMEOUT_MS = 4000;

/**
 * What the Sign button should offer before anyone clicks it: "no-extension",
 * "no-wallet", "unsupported", "not-joined" or "ready". Anything the check
 * can't read counts as "ready", so Sign runs the real check and says what's wrong.
 * That includes no answer in time: only this check is limited, since a real
 * signature waits for as long as the user keeps Gleam's window open.
 */
export async function checkGleam(runtime) {
  const timedOut = new Promise((resolve) => setTimeout(() => resolve({ kind: "interrupted" }), CHECK_TIMEOUT_MS));
  const outcome = await Promise.race([sendToGleam(runtime, { type: ATTEST_STATUS_MESSAGE_TYPE }), timedOut]);
  if (outcome.kind === "no-extension") return "no-extension";
  if (outcome.kind === "reply" && !outcome.reply.ok) return READINESS_BY_CODE[outcome.reply.code] || "ready";
  return "ready";
}

// What each state shows. `action` is the one next step the page offers:
// "retry" shows the Sign button again, "store" the install link, "agent" a
// way back to the instructions for a new scan, "view" the entry on review-results.html,
// "wallet" nothing to click (the sentence says where to go in Gleam).
const FALLBACK = {
  success: "Your attestation is recorded.",
  "no-extension": "Gleam isn't installed in this browser, so it can't sign this attestation.",
  interrupted: "Gleam stopped answering before it finished. Your attestation was not recorded as far as this page can tell, so try again.",
  "no-wallet": "Gleam has no wallet registered for points. Create one in Gleam, join Gleam Points, then come back to this link.",
  already: "This wallet already scanned this area of the release. Each wallet scans an area once per release.",
  superseded: "A newer release is out, so this scan can't be signed. Ask your agent to scan the latest release.",
  expired: "This scan can't be signed any more. Ask your agent to start a new one.",
  busy: "Gleam is already showing an attestation to sign. Finish or close that window, then try again.",
  retry: "The attestation wasn't recorded. Try again.",
};

const BY_CODE = {
  no_wallet: ["no-wallet", "wallet"],
  wallet_not_registered: ["no-wallet", "wallet"],
  already_attested: ["already", "view"],
  release_not_latest: ["superseded", "agent"],
  busy: ["busy", "retry"],
  // The link or its challenge is no good: signing it again can't help.
  invalid_attestation: ["expired", "agent"],
  malformed_request: ["expired", "agent"],
  commit_mismatch: ["expired", "agent"],
  challenge_unknown: ["expired", "agent"],
  challenge_wrong_release: ["expired", "agent"],
  challenge_wrong_commit: ["expired", "agent"],
  challenge_expired: ["expired", "agent"],
  challenge_used: ["expired", "agent"],
  answers_failed: ["expired", "agent"],
  unknown_release: ["expired", "agent"],
  // Everything else is worth another go once the cause (named in `error`) is dealt with.
  refused: ["retry", "retry"],
  unsupported_wallet: ["retry", "retry"],
  rejected: ["retry", "retry"],
  timed_out: ["retry", "retry"],
  signing_failed: ["retry", "retry"],
  offline: ["retry", "retry"],
  message_mismatch: ["retry", "retry"],
  invalid_signature: ["retry", "retry"],
  wallet_not_live: ["retry", "retry"],
  no_release: ["retry", "retry"],
  rate_limited: ["retry", "retry"],
  github_unavailable: ["retry", "retry"],
  challenge_unavailable: ["retry", "retry"],
  server_error: ["retry", "retry"],
};

/**
 * Turns the result of `sendAttestation` into what the page shows:
 * `{ state, message, action, points?, paid?, attestationId? }`. `message` is
 * the extension's own sentence when it sent one, so the page and Gleam's
 * window say the same thing. Unknown codes fall back to "retry".
 */
export function describeOutcome(outcome) {
  if (outcome.kind === "no-extension") return { state: "no-extension", message: FALLBACK["no-extension"], action: "store" };
  if (outcome.kind === "interrupted") return { state: "interrupted", message: FALLBACK.interrupted, action: "retry" };
  const reply = outcome.reply;
  if (reply.ok) {
    const id = typeof reply.attestationId === "string" && ID_PATTERN.test(reply.attestationId) ? reply.attestationId : null;
    const paid = reply.paid === true;
    let state = "success";
    let message = "Your attestation is signed and recorded.";
    if (paid) {
      message = `Your attestation is signed and recorded. You earned ${formatPoints(reply.points)} points.`;
    } else if (reply.unpaidReason === "places_taken") {
      state = "full";
      message = "Your attestation is recorded, but this release's paid places are taken, so it earns no points.";
    } else if (reply.unpaidReason === "no_snapshot") {
      state = "unpaid";
      message = "Your attestation is recorded. It earned no points yet, because no daily points count exists to base them on.";
    } else {
      state = "unpaid";
      message = "Your attestation is recorded. It earned no points.";
    }
    return { state, message, action: "view", paid, points: paid ? reply.points : "0", attestationId: id };
  }
  const code = typeof reply.code === "string" ? reply.code : "";
  const [state, action] = BY_CODE[code] || ["retry", "retry"];
  const text = typeof reply.error === "string" && reply.error.trim() !== "" ? reply.error.trim() : FALLBACK[state];
  return { state, message: text, action };
}

/** Final states have nothing left to sign: the page shows the state's own next step and no Sign button. */
export function isFinal(outcome) {
  return outcome.action === "view" || outcome.action === "agent";
}

