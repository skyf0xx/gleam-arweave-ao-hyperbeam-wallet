import { canonicalJson, sha256Hex } from "./canonical";
import { ATTESTATION_ID_PATTERN, RELEASE_PATTERN } from "./format";
import { isScannablePath } from "./surface";
import type { ScanIssue } from "./issues";

export type ScanResult = "pass" | "scanned";

export interface AttestationAnswer {
  /** Repo-relative path of a surface file. */
  file: string;
  /** The function's symbol, exactly as the challenge names it. */
  symbol: string;
  /** 1-based line of a security check inside the function. */
  line: number;
  /** One sentence: what that check prevents. */
  check: string;
}

/** What a scan signs (SCANS.md § The attestation). */
export interface Attestation {
  release: string;
  commit: string;
  model: string;
  challenge: string;
  answers: AttestationAnswer[];
  result: ScanResult;
  report: string;
}

export const CHALLENGE_SIZE = 3;

export const ATTESTATION_LIMITS = {
  modelMaxLength: 64,
  fileMaxLength: 200,
  symbolMaxLength: 128,
  maxLine: 1_000_000,
  checkMinLength: 10,
  checkMaxLength: 300,
  reportMaxLength: 20_000,
} as const;

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
/** The server's challenge id: 16 to 32 random bytes in base64url. */
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{22,43}$/;
/** Printable ASCII only, so a label can't hide characters or mimic another with look-alikes. */
const MODEL_PATTERN = /^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_.@-]+$/;
const SYMBOL_PATTERN = /^[A-Za-z_$#][\w$]*(\.[A-Za-z_$#][\w$]*)?$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;
// eslint-disable-next-line no-control-regex
const REPORT_FORBIDDEN = /[\x00-\x08\x0b-\x1f\x7f]/;

/** Unpaired UTF-16 surrogates: no valid UTF-8 form, so Postgres jsonb and other tools mangle or refuse them. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Line separators and bidi controls, which can make public text on scan-results.html read differently from what was signed. */
const DECEPTIVE_CHARACTERS = /[\u0085\u2028\u2029\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
/** Characters that render as nothing, so shown text can hide content or differ from what was signed. */
const INVISIBLE_CHARACTERS = /[\u00AD\u200B-\u200D\u2060\uFEFF\u{E0000}-\u{E007F}]/u;

const ATTESTATION_KEYS = ["release", "commit", "model", "challenge", "answers", "result", "report"] as const;
const ANSWER_KEYS = ["file", "symbol", "line", "check"] as const;

export function isRelease(value: string): boolean {
  return RELEASE_PATTERN.test(value);
}

export function isChallengeId(value: string): boolean {
  return CHALLENGE_ID_PATTERN.test(value);
}

export function isAttestationId(value: string): boolean {
  return ATTESTATION_ID_PATTERN.test(value);
}

declare const parsed: unique symbol;

/** An attestation `parseAttestation` accepted. Only it can make one, so only checked input is hashed. */
export type ParsedAttestation = Attestation & { readonly [parsed]: true };

/** The attestation id: lowercase hex SHA-256 of its canonical JSON. */
export function attestationId(attestation: ParsedAttestation): Promise<string> {
  return sha256Hex(canonicalJson(attestation));
}

export type ParseAttestationResult = { ok: true; attestation: ParsedAttestation } | { ok: false; issues: ScanIssue[] };

/**
 * Validates an attestation that arrived as untrusted JSON. It reports every
 * problem rather than the first, and returns a copy holding only the known
 * keys, so what gets hashed is exactly what was checked.
 */
export function parseAttestation(value: unknown): ParseAttestationResult {
  const issues: ScanIssue[] = [];
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [{ code: "not-an-object", path: "$", message: "The attestation must be a JSON object; send the object itself." }],
    };
  }
  checkKeys(value, ATTESTATION_KEYS, "", issues);
  const flagged = unsafeStrings(value, ["release", "commit", "model", "challenge", "report"], ["model", "report"], "", issues);

  const release = value.release;
  if ("release" in value && !flagged.has("release") && !(typeof release === "string" && RELEASE_PATTERN.test(release))) {
    issues.push(invalid("release", "must be the release version as x.y.z, such as 1.4.0"));
  }
  if ("commit" in value && !flagged.has("commit") && !(typeof value.commit === "string" && COMMIT_PATTERN.test(value.commit))) {
    issues.push(invalid("commit", "must be the tag's full 40-character lowercase hex commit sha"));
  }
  const model = value.model;
  if (
    "model" in value &&
    !flagged.has("model") &&
    !(typeof model === "string" && model.length <= ATTESTATION_LIMITS.modelMaxLength && MODEL_PATTERN.test(model))
  ) {
    issues.push(
      invalid(
        "model",
        `must be 1 to ${ATTESTATION_LIMITS.modelMaxLength} printable ASCII characters with no leading or trailing space, such as claude-opus-5-5`,
      ),
    );
  }
  if ("challenge" in value && !flagged.has("challenge") && !(typeof value.challenge === "string" && CHALLENGE_ID_PATTERN.test(value.challenge))) {
    issues.push(invalid("challenge", "must be the challenge id `pnpm scan start` printed, unchanged"));
  }
  if ("result" in value && value.result !== "pass" && value.result !== "scanned") {
    issues.push(invalid("result", 'must be "pass" if you filed nothing, or "scanned" if you filed a PR or an advisory'));
  }
  const report = value.report;
  if ("report" in value && !flagged.has("report")) {
    if (typeof report !== "string" || report.trim() === "" || report.length > ATTESTATION_LIMITS.reportMaxLength) {
      issues.push(
        invalid("report", `must be non-empty markdown of at most ${ATTESTATION_LIMITS.reportMaxLength} characters`),
      );
    } else if (REPORT_FORBIDDEN.test(report)) {
      issues.push(invalid("report", "must use \\n line endings and contain no other control characters"));
    }
  }

  const answers: AttestationAnswer[] = [];
  if ("answers" in value) {
    const raw = value.answers;
    if (!Array.isArray(raw)) {
      issues.push(invalid("answers", `must be an array of ${CHALLENGE_SIZE} answers, one per challenge function`));
    } else {
      if (raw.length !== CHALLENGE_SIZE) {
        issues.push({
          code: "wrong-answer-count",
          path: "answers",
          message: `answers has ${raw.length} entries; give exactly ${CHALLENGE_SIZE}, one per challenge function.`,
        });
      }
      const seen = new Map<string, number>();
      raw.forEach((entry: unknown, index) => {
        const answer = parseAnswer(entry, `answers[${index}]`, issues);
        if (!answer) return;
        const key = `${answer.file}\n${answer.symbol}`;
        const first = seen.get(key);
        if (first !== undefined) {
          issues.push({
            code: "duplicate-answer",
            path: `answers[${index}]`,
            message: `answers[${index}] repeats answers[${first}] (\`${answer.symbol}\` in ${answer.file}); answer each challenge function once.`,
          });
        } else seen.set(key, index);
        answers.push(answer);
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    attestation: {
      release: release as string,
      commit: value.commit as string,
      model: model as string,
      challenge: value.challenge as string,
      answers,
      result: value.result as ScanResult,
      report: report as string,
    } as ParsedAttestation,
  };
}

function parseAnswer(entry: unknown, at: string, issues: ScanIssue[]): AttestationAnswer | null {
  if (!isPlainObject(entry)) {
    issues.push({
      code: "not-an-object",
      path: at,
      message: `${at} must be an object with file, symbol, line and check.`,
    });
    return null;
  }
  const before = issues.length;
  checkKeys(entry, ANSWER_KEYS, `${at}.`, issues);
  const flagged = unsafeStrings(entry, ["file", "symbol", "check"], ["check"], `${at}.`, issues);
  const { file, symbol, line, check } = entry;
  if ("file" in entry && !flagged.has("file") && !(typeof file === "string" && isRepoPath(file) && isScannablePath(file))) {
    issues.push(invalid(`${at}.file`, "must be the challenge's repo-relative .ts or .tsx path, such as packages/core/src/vault/encryption.ts"));
  }
  if (
    "symbol" in entry &&
    !flagged.has("symbol") &&
    !(typeof symbol === "string" && symbol.length <= ATTESTATION_LIMITS.symbolMaxLength && SYMBOL_PATTERN.test(symbol))
  ) {
    issues.push(invalid(`${at}.symbol`, "must be the function's symbol exactly as the challenge names it, such as readTransaction or Vault.unlock"));
  }
  if (
    "line" in entry &&
    !(typeof line === "number" && Number.isSafeInteger(line) && line >= 1 && line <= ATTESTATION_LIMITS.maxLine)
  ) {
    issues.push(invalid(`${at}.line`, "must be a whole 1-based line number"));
  }
  if ("check" in entry && !flagged.has("check")) {
    const { checkMinLength: min, checkMaxLength: max } = ATTESTATION_LIMITS;
    if (typeof check !== "string" || check.length < min || check.length > max) {
      issues.push(invalid(`${at}.check`, `must be one sentence of ${min} to ${max} characters on what the cited line prevents`));
    } else if (CONTROL_CHARACTERS.test(check) || check.trim() !== check) {
      issues.push(invalid(`${at}.check`, "must be a single line with no leading or trailing whitespace"));
    }
  }
  if (issues.length > before) return null;
  return { file: file as string, symbol: symbol as string, line: line as number, check: check as string };
}

/**
 * Reports string fields holding an unpaired surrogate, and the `shown`
 * fields holding a line separator, bidi control or invisible character. Returns the fields it
 * reported, so their other rules aren't reported on top.
 */
function unsafeStrings(
  object: Record<string, unknown>,
  fields: readonly string[],
  shown: readonly string[],
  prefix: string,
  issues: ScanIssue[],
): Set<string> {
  const flagged = new Set<string>();
  for (const field of fields) {
    const text = object[field];
    if (typeof text !== "string") continue;
    if (LONE_SURROGATE.test(text)) {
      issues.push(invalid(`${prefix}${field}`, "contains an unpaired surrogate (a broken character); remove it"));
      flagged.add(field);
    } else if (shown.includes(field) && DECEPTIVE_CHARACTERS.test(text)) {
      issues.push(
        invalid(
          `${prefix}${field}`,
          "contains a line separator (U+0085, U+2028, U+2029) or a bidi control (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069); remove it",
        ),
      );
      flagged.add(field);
    } else if (shown.includes(field) && INVISIBLE_CHARACTERS.test(text)) {
      issues.push(
        invalid(
          `${prefix}${field}`,
          "contains an invisible character (U+00AD, U+200B–U+200D, U+2060, U+FEFF or a tag character U+E0000–U+E007F); remove it",
        ),
      );
      flagged.add(field);
    }
  }
  return flagged;
}

function isRepoPath(path: string): boolean {
  if (path.length === 0 || path.length > ATTESTATION_LIMITS.fileMaxLength) return false;
  return path.split("/").every((segment) => PATH_SEGMENT_PATTERN.test(segment) && segment !== "." && segment !== "..");
}

function checkKeys(object: Record<string, unknown>, allowed: readonly string[], prefix: string, issues: ScanIssue[]): void {
  for (const key of allowed) {
    if (!(key in object)) {
      issues.push({ code: "missing-key", path: `${prefix}${key}`, message: `${prefix}${key} is missing; add it.` });
    }
  }
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      issues.push({
        code: "unknown-key",
        path: `${prefix}${key}`,
        message: `${prefix}${key} isn't part of the attestation format; remove it.`,
      });
    }
  }
}

function invalid(path: string, rule: string): ScanIssue {
  return { code: "invalid-value", path, message: `${path} ${rule}.` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
