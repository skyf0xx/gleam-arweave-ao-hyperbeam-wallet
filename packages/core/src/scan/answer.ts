import type { AttestationAnswer } from "./attestation";
import type { ChallengeFunction } from "./challenge";
import { MAX_SCAN_FILE_BYTES, isJsxPath, scanFile, type FunctionSpan, type ScannedFile } from "./functions";
import type { ScanIssue } from "./issues";

/**
 * Checks that an answer's line lies in the body of the named function and
 * holds code: not blank, not only a comment, not bare punctuation such as
 * `}` or `});`. The declaration and parameter lines are refused too,
 * because a check there (a default parameter) is rare and accepting the
 * signature would let an answer cite a line without reading the body.
 *
 * `at` prefixes each issue's path, such as `answers[1]`.
 */
export function checkAnswer(fileText: string, answer: AttestationAnswer, at = "answer"): ScanIssue[] {
  return checkAgainst(scanFile(fileText, { jsx: isJsxPath(answer.file) }), answer, at);
}

function checkAgainst(scanned: ScannedFile, answer: AttestationAnswer, at: string): ScanIssue[] {
  const { file, symbol, line } = answer;
  if (scanned.tooLarge) {
    return [
      {
        code: "file-too-large",
        path: `${at}.file`,
        message: `${at}.file ${file} is over ${MAX_SCAN_FILE_BYTES / 1_000_000} MB, which is more than the scan checks; report it to the maintainers, since no challenge should name it.`,
      },
    ];
  }
  const fn = scanned.functions.find((candidate) => candidate.symbol === symbol);
  if (!fn) {
    return [
      {
        code: "symbol-not-found",
        path: `${at}.symbol`,
        message: `${at}.symbol \`${symbol}\` isn't a function in ${file}; use the symbol exactly as the challenge names it.`,
      },
    ];
  }
  const body = bodyRange(fn);
  const issue = (code: ScanIssue["code"], problem: string): ScanIssue[] => [
    {
      code,
      path: `${at}.line`,
      message: `${at}.line ${line} ${problem}; cite a line in the body of \`${symbol}\` (lines ${body}) that makes a check.`,
    },
  ];

  if (line < 1 || line > scanned.lexed.lineCount) {
    return issue("line-out-of-range", `is past the end of ${file} (${scanned.lexed.lineCount} lines)`);
  }
  if (line < fn.startLine || line > fn.endLine) {
    return issue("line-outside-function", `is outside \`${symbol}\` (lines ${fn.startLine}–${fn.endLine})`);
  }
  if (line === fn.endLine) return issue("line-outside-function", `is the line that closes \`${symbol}\``);
  if (line <= fn.bodyStartLine) return issue("line-in-signature", `is in the signature of \`${symbol}\``);

  const { content, punctuation, comment } = scanned.lexed;
  if (content[line]) return [];
  if (punctuation[line]) return issue("line-punctuation", "holds only punctuation");
  if (comment[line]) return issue("line-comment", "is a comment");
  return issue("line-blank", "is blank");
}

function bodyRange(fn: FunctionSpan): string {
  const first = fn.bodyStartLine + 1;
  const last = fn.endLine - 1;
  return first === last ? String(first) : `${first}–${last}`;
}

/**
 * Checks a full set of answers against the challenge and the code at the
 * attested commit. Answers may come in any order, but together they must
 * name each challenge function exactly once. `files` maps a repo path to
 * its text; a challenge file missing from it is reported, not skipped.
 */
export function checkAnswers(
  answers: readonly AttestationAnswer[],
  challenge: readonly ChallengeFunction[],
  files: ReadonlyMap<string, string>,
): ScanIssue[] {
  const issues: ScanIssue[] = [];
  const keyOf = (fn: ChallengeFunction) => `${fn.file}\n${fn.symbol}`;
  const answered = new Set(answers.map(keyOf));
  const unanswered = challenge.filter((fn) => !answered.has(keyOf(fn)));
  const wanted = new Set(challenge.map(keyOf));
  const seen = new Set<string>();
  const scans = new Map<string, ScannedFile>();

  answers.forEach((answer, index) => {
    const at = `answers[${index}]`;
    const key = keyOf(answer);
    if (!wanted.has(key)) {
      const suggestion = unanswered.map((fn) => `\`${fn.symbol}\` in ${fn.file}`).join(" or ");
      issues.push({
        code: "answer-not-in-challenge",
        path: at,
        message: `${at} names \`${answer.symbol}\` in ${answer.file}, which isn't in the challenge; answer ${suggestion || "a challenge function"} instead.`,
      });
      return;
    }
    if (seen.has(key)) {
      issues.push({
        code: "duplicate-answer",
        path: at,
        message: `${at} answers \`${answer.symbol}\` in ${answer.file} a second time; answer each challenge function once.`,
      });
      return;
    }
    seen.add(key);
    const text = files.get(answer.file);
    if (text === undefined) {
      issues.push({
        code: "file-unavailable",
        path: `${at}.file`,
        message: `${at}.file ${answer.file} isn't in the release at this commit; check the path against the challenge.`,
      });
      return;
    }
    let scanned = scans.get(answer.file);
    if (!scanned) {
      scanned = scanFile(text, { jsx: isJsxPath(answer.file) });
      scans.set(answer.file, scanned);
    }
    issues.push(...checkAgainst(scanned, answer, at));
  });

  for (const fn of unanswered) {
    issues.push({
      code: "challenge-function-unanswered",
      path: "answers",
      message: `No answer names \`${fn.symbol}\` in ${fn.file}; add one, since the challenge asks for it.`,
    });
  }
  return issues;
}
