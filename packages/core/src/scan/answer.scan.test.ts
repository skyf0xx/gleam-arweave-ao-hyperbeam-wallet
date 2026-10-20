import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAnswer, checkAnswers } from "./answer";
import { MAX_SCAN_FILE_BYTES } from "./functions";
import type { AttestationAnswer } from "./attestation";

const sample = readFileSync(resolve(__dirname, "fixtures", "sample.ts.txt"), "utf8");
const panel = readFileSync(resolve(__dirname, "fixtures", "panel.tsx.txt"), "utf8");

function lineOf(text: string, needle: string): number {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`"${needle}" isn't in the fixture`);
  return index + 1;
}

const FILE = "packages/core/src/vault/sample.ts";
const answer = (symbol: string, line: number, file = FILE): AttestationAnswer => ({
  file,
  symbol,
  line,
  check: "Stops a short password from opening the vault.",
});
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe("checkAnswer", () => {
  it("accepts a check line inside the function", () => {
    expect(checkAnswer(sample, answer("unlockVault", lineOf(sample, "password.length < 8")))).toEqual([]);
    expect(checkAnswer(sample, answer("unlockVault", lineOf(sample, "const pattern = /^https")))).toEqual([]);
    expect(checkAnswer(sample, answer("KeySession.get", lineOf(sample, "if (!walletId) {")))).toEqual([]);
  });

  it("accepts a line inside a multi-line template", () => {
    const text = ["function f(a: string) {", "  const t = `x", "  ${a} y`;", "  return t;", "}"].join("\n");

    expect(checkAnswer(text, answer("f", 3))).toEqual([]);
  });

  it("accepts a line in a TSX component", () => {
    const file = "apps/extension/entrypoints/approval/src/Panel.tsx";

    expect(checkAnswer(panel, answer("ApprovalPanel", lineOf(panel, 'startsWith("https://")'), file))).toEqual([]);
    expect(checkAnswer(panel, answer("ApprovalPanel", lineOf(panel, "disabled={!ack}"), file))).toEqual([]);
  });

  it("rejects a line outside the function, naming its span", () => {
    const line = lineOf(sample, "const ratio");
    const [issue] = checkAnswer(sample, answer("unlockVault", line), "answers[1]");
    const start = lineOf(sample, "export async function unlockVault");
    const end = lineOf(sample, "return { ok: label.length > 0 };") + 1;

    expect(issue).toEqual({
      code: "line-outside-function",
      path: "answers[1].line",
      message: `answers[1].line ${line} is outside \`unlockVault\` (lines ${start}–${end}); cite a line in the body of \`unlockVault\` (lines ${start + 1}–${end - 1}) that makes a check.`,
    });
  });

  it("rejects the closing line", () => {
    const line = lineOf(sample, "return { ok: label.length > 0 };") + 1;

    expect(codes(checkAnswer(sample, answer("unlockVault", line)))).toEqual(["line-outside-function"]);
  });

  it("rejects a line past the end of the file", () => {
    expect(codes(checkAnswer(sample, answer("unlockVault", 10_000)))).toEqual(["line-out-of-range"]);
  });

  it("rejects the declaration and every line of a multi-line signature", () => {
    expect(codes(checkAnswer(sample, answer("unlockVault", lineOf(sample, "function unlockVault"))))).toEqual([
      "line-in-signature",
    ]);
    expect(codes(checkAnswer(sample, answer("withTypeLiteral", lineOf(sample, "input: { a: string },"))))).toEqual([
      "line-in-signature",
    ]);
  });

  it("rejects a blank line", () => {
    const line = lineOf(sample, "return { ok: label.length > 0 };") - 1;

    expect(codes(checkAnswer(sample, answer("unlockVault", line)))).toEqual(["line-blank"]);
  });

  it("rejects a comment line", () => {
    const line = lineOf(sample, "// a comment with an unbalanced brace");

    expect(codes(checkAnswer(sample, answer("unlockVault", line)))).toEqual(["line-comment"]);
  });

  it("rejects every line of a block comment, starred or not", () => {
    const text = ["function f() {", "  /*", "   * one", "   two", "  */", "  return 1;", "}"].join("\n");

    for (const line of [2, 3, 4, 5]) expect(codes(checkAnswer(text, answer("f", line)))).toEqual(["line-comment"]);
  });

  it("rejects a line of bare punctuation", () => {
    const closing = lineOf(sample, "return { ok: false };") + 1;

    expect(codes(checkAnswer(sample, answer("unlockVault", closing)))).toEqual(["line-punctuation"]);
    const text = ["function f() {", "  g(() => {", "    return 1;", "  });", "}"].join("\n");
    expect(codes(checkAnswer(text, answer("f", 4)))).toEqual(["line-punctuation"]);
  });

  it("rejects a symbol that isn't in the file", () => {
    expect(codes(checkAnswer(sample, answer("shorthand", 1)))).toEqual(["symbol-not-found"]);
    expect(codes(checkAnswer(sample, answer("helper", 1)))).toEqual(["symbol-not-found"]);
  });
});

describe("checkAnswers", () => {
  const OTHER = "apps/extension/entrypoints/approval/src/Panel.tsx";
  const files = new Map([
    [FILE, sample],
    [OTHER, panel],
  ]);
  const challenge = [
    { file: FILE, symbol: "unlockVault" },
    { file: FILE, symbol: "KeySession.get" },
    { file: OTHER, symbol: "ApprovalPanel" },
  ];
  const good = [
    answer("ApprovalPanel", lineOf(panel, 'startsWith("https://")'), OTHER),
    answer("unlockVault", lineOf(sample, "password.length < 8")),
    answer("KeySession.get", lineOf(sample, "if (!walletId) {")),
  ];

  it("accepts correct answers in any order", () => {
    expect(checkAnswers(good, challenge, files)).toEqual([]);
  });

  it("collects every failure instead of stopping at the first", () => {
    const answers = [
      answer("ApprovalPanel", 1, OTHER),
      answer("unlockVault", lineOf(sample, "// a comment with")),
      answer("isAllowedOrigin", lineOf(sample, "ratio > 100")),
    ];
    const issues = checkAnswers(answers, challenge, files);

    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["line-outside-function", "answers[0].line"],
      ["line-comment", "answers[1].line"],
      ["answer-not-in-challenge", "answers[2]"],
      ["challenge-function-unanswered", "answers"],
    ]);
    expect(issues[2]!.message).toContain("answer `KeySession.get` in packages/core/src/vault/sample.ts instead");
  });

  it("matches paths exactly: a ./ prefix or a different case isn't the challenge's file", () => {
    const answers = [
      { ...good[0]!, file: `./${OTHER}` },
      { ...good[1]!, file: FILE.toUpperCase() },
      good[2]!,
    ];

    expect(codes(checkAnswers(answers, challenge, files))).toEqual([
      "answer-not-in-challenge",
      "answer-not-in-challenge",
      "challenge-function-unanswered",
      "challenge-function-unanswered",
    ]);
  });

  it("reports a file over the size cap instead of scanning it", () => {
    const huge = `function f() {\n  return 1;\n}\n${"x".repeat(MAX_SCAN_FILE_BYTES)}`;
    const [issue] = checkAnswer(huge, answer("f", 2), "answers[0]");

    expect(issue?.code).toBe("file-too-large");
    expect(issue?.message).toContain(`${FILE} is over 1 MB`);
    expect(codes(checkAnswer(`${"é".repeat(MAX_SCAN_FILE_BYTES / 2 + 1)}`, answer("f", 1)))).toEqual(["file-too-large"]);
  });

  it("reports a repeated answer and a file it can't read", () => {
    const issues = checkAnswers([good[1]!, good[1]!, good[2]!], challenge, new Map([[FILE, sample]]));

    expect(codes(issues)).toEqual(["duplicate-answer", "challenge-function-unanswered"]);
    expect(codes(checkAnswers(good, challenge, new Map([[FILE, sample]])))).toEqual(["file-unavailable"]);
  });
});
