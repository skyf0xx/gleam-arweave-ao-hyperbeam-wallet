import { describe, expect, it } from "vitest";
import { attestationId, isAttestationId, parseAttestation, type Attestation } from "./attestation";
import { canonicalJson } from "./canonical";

const VALID: Attestation = {
  release: "1.4.0",
  commit: "0123456789abcdef0123456789abcdef01234567",
  model: "claude-opus-5-5",
  challenge: "q7Xh2mB9kLp4Wz0RtY6uVa",
  answers: [
    {
      file: "packages/core/src/vault/encryption.ts",
      symbol: "decrypt",
      line: 120,
      check: "Refuses a ciphertext whose tag doesn't verify.",
    },
    {
      file: "apps/extension/src/handlers/provider-params.ts",
      symbol: "readTransaction",
      line: 212,
      check: "Rejects a transaction with an unknown format.",
    },
    {
      file: "apps/extension/src/handlers/approval.ts",
      symbol: "ApprovalHandler.resolveApproval",
      line: 300,
      check: "Ignores a resolution for an expired request.",
    },
  ],
  result: "pass",
  report: "# Scan\n\nRead the vault, signing and approval code.\n",
};

const withField = (patch: Record<string, unknown>): unknown => ({ ...VALID, ...patch });
const withAnswer = (index: number, patch: Record<string, unknown>): unknown => ({
  ...VALID,
  answers: VALID.answers.map((answer, at) => (at === index ? { ...answer, ...patch } : answer)),
});
const issuesOf = (value: unknown) => {
  const parsed = parseAttestation(value);
  return parsed.ok ? [] : parsed.issues;
};

describe("parseAttestation", () => {
  it("accepts a valid attestation and returns a copy of the known keys", () => {
    const parsed = parseAttestation(JSON.parse(JSON.stringify(VALID)));

    expect(parsed).toEqual({ ok: true, attestation: VALID });
  });

  it("refuses anything but a plain object", () => {
    for (const value of [null, [], "x", 1, new Date()]) {
      expect(issuesOf(value).map((issue) => issue.code)).toEqual(["not-an-object"]);
    }
  });

  it("reports missing and unknown keys, at the top and in answers", () => {
    const rest: Record<string, unknown> = { ...VALID };
    delete rest.model;
    const issues = issuesOf({ ...rest, extra: 1, answers: [{ ...VALID.answers[0], why: "x" }, ...VALID.answers.slice(1)] });

    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["missing-key", "model"],
      ["unknown-key", "extra"],
      ["unknown-key", "answers[0].why"],
    ]);
  });

  it.each([
    ["release", { release: "1.4" }],
    ["release", { release: "v1.4.0" }],
    ["release", { release: "1.4.0-rc.1" }],
    ["release", { release: "01.4.0" }],
    ["commit", { commit: "0123456789ABCDEF0123456789ABCDEF01234567" }],
    ["commit", { commit: "abc123" }],
    ["model", { model: "" }],
    ["model", { model: " claude" }],
    ["model", { model: "x".repeat(65) }],
    ["model", { model: "clаude" }],
    ["challenge", { challenge: "short" }],
    ["challenge", { challenge: "has spaces in it and is long enough" }],
    ["result", { result: "clean" }],
    ["report", { report: "   " }],
    ["report", { report: "x".repeat(20_001) }],
    ["report", { report: "line\r\nline" }],
    ["answers", { answers: "none" }],
  ])("rejects a bad %s", (path, patch) => {
    expect(issuesOf(withField(patch)).map((issue) => [issue.code, issue.path])).toEqual([["invalid-value", path]]);
  });

  it.each([
    ["file", { file: "/etc/passwd" }],
    ["file", { file: "packages/../secret.ts" }],
    ["file", { file: "packages/core/src/vault/encryption.test.ts" }],
    ["file", { file: "pnpm-lock.yaml" }],
    ["symbol", { symbol: "a.b.c" }],
    ["symbol", { symbol: "1abc" }],
    ["line", { line: 0 }],
    ["line", { line: 1.5 }],
    ["line", { line: "12" }],
    ["check", { check: "too short" }],
    ["check", { check: "x".repeat(301) }],
    ["check", { check: "Two lines\nof text here." }],
    ["check", { check: " Leading space is padding." }],
  ])("rejects an answer with a bad %s", (field, patch) => {
    expect(issuesOf(withAnswer(1, patch)).map((issue) => [issue.code, issue.path])).toEqual([
      ["invalid-value", `answers[1].${field}`],
    ]);
  });

  it("wants exactly three answers, each a distinct function", () => {
    expect(issuesOf(withField({ answers: VALID.answers.slice(0, 2) })).map((issue) => issue.code)).toEqual([
      "wrong-answer-count",
    ]);
    const repeated = [VALID.answers[0], VALID.answers[1], { ...VALID.answers[0], line: 121 }];
    expect(issuesOf(withField({ answers: repeated })).map((issue) => [issue.code, issue.path])).toEqual([
      ["duplicate-answer", "answers[2]"],
    ]);
  });

  it("collects every problem, each with a fix", () => {
    const issues = issuesOf(withField({ release: "x", commit: "y", result: "z" }));

    expect(issues.map((issue) => issue.path)).toEqual(["release", "commit", "result"]);
    for (const issue of issues) expect(issue.message).toMatch(/^\S+ .+\.$/);
  });
});

describe("parseAttestation on hostile text", () => {
  it("treats a __proto__ key from JSON as an unknown key, not a prototype", () => {
    const top = JSON.parse(`{"__proto__":{"admin":true},${JSON.stringify(VALID).slice(1)}`) as unknown;
    const answers = VALID.answers.map((answer) => JSON.stringify(answer));
    answers[0] = `{"__proto__":{"line":1},${answers[0]!.slice(1)}`;
    const nested = JSON.parse(`${JSON.stringify(VALID).replace(/"answers":\[.*\],"result"/, `"answers":[${answers.join(",")}],"result"`)}`) as unknown;

    expect(issuesOf(top).map((issue) => [issue.code, issue.path])).toEqual([["unknown-key", "__proto__"]]);
    expect(issuesOf(nested).map((issue) => [issue.code, issue.path])).toEqual([["unknown-key", "answers[0].__proto__"]]);
  });

  it.each([
    ["report", withField({ report: "Read it all \uD800 done." })],
    ["report", withField({ report: "Trailing low \uDC00" })],
    ["answers[0].check", withAnswer(0, { check: "Blocks a \uDBFF forged origin." })],
    ["answers[0].file", withAnswer(0, { file: "packages/core/src/vault/\uD800.ts" })],
    ["model", withField({ model: "\uD800" })],
  ])("rejects an unpaired surrogate in %s", (path, value) => {
    const issues = issuesOf(value);

    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([["invalid-value", path]]);
    expect(issues[0]!.message).toContain("unpaired surrogate");
  });

  it("accepts a properly paired astral character", () => {
    expect(issuesOf(withField({ report: "Checked the vault \u{1F512} code." }))).toEqual([]);
  });

  it.each(["\u2028", "\u2029", "\u0085", "\u202E", "\u2066", "\u200F"])(
    "rejects %j in model, check and report",
    (character) => {
      expect(issuesOf(withField({ report: `Report ${character} text.` }))[0]?.path).toBe("report");
      expect(issuesOf(withAnswer(2, { check: `Stops a ${character} replay attack.` }))[0]?.path).toBe("answers[2].check");
      const modelIssues = issuesOf(withField({ model: `claude${character}` }));
      expect(modelIssues.map((issue) => issue.path)).toEqual(["model"]);
      expect(modelIssues[0]!.message).toContain("remove it");
    },
  );
});

describe("attestation id", () => {
  const idOf = async (value: unknown) => {
    const result = parseAttestation(value);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return attestationId(result.attestation);
  };

  // Golden vector, cross-checked with Python:
  // sha256(json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)).
  it("is lowercase hex SHA-256 of the canonical JSON", async () => {
    const id = await idOf(VALID);

    expect(isAttestationId(id)).toBe(true);
    expect(id).toBe("e896767fb69bca080ad08d2dc3cba3a07ef7727a6030339df47c815f38eb9c48");
  });

  it("doesn't depend on key order", async () => {
    const shuffled = Object.fromEntries(Object.entries(VALID).reverse()) as Record<string, unknown>;
    shuffled.answers = VALID.answers.map((answer) => Object.fromEntries(Object.entries(answer).reverse()));

    expect(canonicalJson(shuffled)).toBe(canonicalJson(VALID));
    expect(await idOf(shuffled)).toBe(await idOf(VALID));
  });

  it("changes when the answers' order or any field changes", async () => {
    const base = await idOf(VALID);

    expect(await idOf({ ...VALID, answers: [...VALID.answers].reverse() })).not.toBe(base);
    expect(await idOf({ ...VALID, result: "scanned" })).not.toBe(base);
  });
});
