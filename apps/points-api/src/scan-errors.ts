import type { ScanIssue } from "@gleam/core/src/scan/index.ts";

/**
 * Codes the scan endpoints answer with, besides the answer-check codes in
 * `ScanIssueCode`. Each message tells the caller what to do next.
 */
export type ScanErrorCode =
  | "malformed_request"
  | "invalid_attestation"
  | "no_release"
  | "unknown_release"
  | "github_unavailable"
  | "challenge_unavailable"
  | "release_not_latest"
  | "commit_mismatch"
  | "challenge_unknown"
  | "challenge_expired"
  | "challenge_used"
  | "challenge_wrong_release"
  | "challenge_wrong_commit"
  | "answers_failed"
  | "message_mismatch"
  | "invalid_signature"
  | "wallet_not_registered"
  | "wallet_not_live"
  | "already_attested"
  | "rate_limited";

export interface ServerIssue {
  code: ScanErrorCode;
  path: string;
  message: string;
}

export type Issue = ScanIssue | ServerIssue;

export interface ScanFailure {
  ok: false;
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503;
  code: ScanErrorCode;
  /** One sentence: the message of the issue that sets `code`. */
  error: string;
  issues: Issue[];
  /** Seconds to wait, sent as `Retry-After`. */
  retryAfterSeconds?: number;
}

export function failure(status: ScanFailure["status"], code: ScanErrorCode, path: string, message: string): ScanFailure {
  return { ok: false, status, code, error: message, issues: [{ code, path, message }] };
}

/**
 * Release and challenge problems, most fundamental first. When several are
 * present, the first one listed here sets the response's `code`, `error`
 * and HTTP status, whatever order they were found in.
 */
const STATE_PRECEDENCE: readonly { code: ScanErrorCode; status: ScanFailure["status"] }[] = [
  { code: "release_not_latest", status: 409 },
  { code: "commit_mismatch", status: 409 },
  { code: "challenge_unknown", status: 404 },
  { code: "challenge_wrong_release", status: 409 },
  { code: "challenge_wrong_commit", status: 409 },
  { code: "challenge_expired", status: 409 },
  { code: "challenge_used", status: 409 },
];

export function failureFromIssues(issues: ServerIssue[]): ScanFailure {
  for (const { code, status } of STATE_PRECEDENCE) {
    const issue = issues.find((candidate) => candidate.code === code);
    if (issue) return { ok: false, status, code, error: issue.message, issues };
  }
  throw new Error("failureFromIssues needs at least one release or challenge issue.");
}

export const NO_RELEASE = failure(
  404,
  "no_release",
  "release",
  "Gleam hasn't published a release yet, so there is nothing to scan; try again once a release is published on GitHub.",
);

export const GITHUB_UNAVAILABLE: ScanFailure = {
  ...failure(
    503,
    "github_unavailable",
    "$",
    "Gleam couldn't read the release from GitHub; run the command again in a minute.",
  ),
  retryAfterSeconds: 60,
};
