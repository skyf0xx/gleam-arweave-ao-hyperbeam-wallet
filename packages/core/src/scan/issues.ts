/**
 * Every check in this module reports problems as issues rather than a
 * boolean, because the agent running `pnpm scan finish` has to fix each one
 * before the user is asked to sign. `message` is one sentence that names
 * the field and says what to change.
 */
export type ScanIssueCode =
  // Attestation shape
  | "not-an-object"
  | "missing-key"
  | "unknown-key"
  | "invalid-value"
  | "wrong-answer-count"
  | "duplicate-answer"
  // Answers against the challenge and the code
  | "answer-not-in-challenge"
  | "challenge-function-unanswered"
  | "file-unavailable"
  | "file-too-large"
  | "symbol-not-found"
  | "line-out-of-range"
  | "line-outside-function"
  | "line-in-signature"
  | "line-blank"
  | "line-comment"
  | "line-punctuation";

export interface ScanIssue {
  code: ScanIssueCode;
  /** The field at fault, such as `answers[1].line`. */
  path: string;
  message: string;
}
