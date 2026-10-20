import {
  attestationId,
  checkAnswers,
  encodeAttestationPayload,
  findFunction,
  isJsxPath,
  parseAttestation,
  type AttestationAnswer,
  type ScanIssue,
} from "../../packages/core/src/scan/index.ts";
import { callApi } from "./api.ts";
import {
  ATTESTATION_FILE,
  CHALLENGE_FILE,
  fail,
  gitOrUndefined,
  isChallengeResponse,
  jsonParseProblem,
  readText,
  STARTED_FILE,
  formatElapsed,
  showAtCommit,
  writeJson,
  type ChallengeResponse,
  type Deps,
  type Outcome,
  type Problem,
} from "./shared.ts";

const START_FIRST = "run `pnpm scan start` first";

export const USER_MESSAGE =
  "Open this link in Chrome with Gleam installed and click Sign with Gleam; it signs no transaction and moves no funds.";

export async function runFinish(deps: Deps): Promise<Outcome> {
  const challengeText = await readText(deps, CHALLENGE_FILE);
  if (challengeText === undefined) {
    return fail("finish", [{ path: CHALLENGE_FILE, message: `There is no challenge yet; ${START_FIRST}.` }]);
  }
  let challengeJson: unknown;
  try {
    challengeJson = JSON.parse(challengeText);
  } catch {
    challengeJson = undefined;
  }
  if (!isChallengeResponse(challengeJson)) {
    return fail("finish", [{ path: CHALLENGE_FILE, message: `${CHALLENGE_FILE} is unreadable; delete .gleam-scan/ and run \`pnpm scan start\` again.` }]);
  }
  const challenge: ChallengeResponse = challengeJson;

  const text = await readText(deps, ATTESTATION_FILE);
  if (text === undefined) {
    return fail("finish", [{ path: ATTESTATION_FILE, message: `There is no attestation file; ${START_FIRST}.` }]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return fail("finish", [jsonParseProblem(ATTESTATION_FILE, text, error)]);
  }

  const issues: Problem[] = [];
  const notes: string[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  // Release, commit and challenge come from git and challenge.json, not from the agent.
  const draft: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const head = await gitOrUndefined(deps, ["rev-parse", "HEAD"]);
  if (head === undefined) {
    push("git", "This isn't a git checkout; run `pnpm scan finish` from the Gleam checkout you scanned.");
  } else {
    const tags = (await gitOrUndefined(deps, ["tag", "--points-at", "HEAD"]))?.split("\n").map((t) => t.trim()) ?? [];
    const releases = tags.flatMap((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1] ?? []);
    const release = releases.includes(challenge.release) ? challenge.release : releases[0];
    if (release === undefined) {
      push("git", `HEAD (${head.slice(0, 7)}) has no v<x.y.z> release tag; run \`git checkout v${challenge.release}\` and \`pnpm scan finish\` again.`);
    } else {
      fill(draft, "release", release, notes);
      fill(draft, "commit", head, notes);
    }
    if (head !== challenge.commit || (release !== undefined && release !== challenge.release)) {
      push(
        "commit",
        `HEAD is ${head.slice(0, 7)} but the challenge is for v${challenge.release} (${challenge.commit.slice(0, 7)}); run \`git checkout v${challenge.release}\` and \`pnpm scan finish\` again.`,
      );
    }
  }
  if (draft.challenge === undefined || draft.challenge === "") draft.challenge = challenge.challenge;
  else if (draft.challenge !== challenge.challenge) {
    push("challenge", `challenge differs from ${CHALLENGE_FILE}; set it to "${challenge.challenge}", or run \`pnpm scan start\` again and re-answer.`);
  }

  // Code at the attested commit, for the answer check and for naming line spans.
  const commit = head ?? challenge.commit;
  const files = new Map<string, string>();
  const paths = new Set(challenge.functions.map((fn) => fn.file));
  if (Array.isArray(draft.answers)) {
    for (const answer of draft.answers) {
      const file = (answer as { file?: unknown } | null)?.file;
      if (typeof file === "string") paths.add(file);
    }
  }
  for (const file of paths) {
    const content = await showAtCommit(deps, commit, file);
    if (content !== undefined) files.set(file, content);
  }

  const placeholderPaths = new Set<string>();
  const placeholder = (path: string, message: string) => {
    placeholderPaths.add(path);
    push(path, message);
  };
  if (draft.model === "") placeholder("model", "model is empty; set it to your model name, such as claude-opus-5-5.");
  if (draft.report === "") placeholder("report", "report is empty; write markdown on what you checked and what you didn't.");
  if (Array.isArray(draft.answers)) {
    draft.answers.forEach((answer, index) => {
      const a = answer as Record<string, unknown> | null;
      if (a === null || typeof a !== "object") return;
      const at = `answers[${index}]`;
      if (a.line === 0) {
        const span =
          typeof a.file === "string" && typeof a.symbol === "string" && files.has(a.file)
            ? findFunction(files.get(a.file)!, a.symbol, { jsx: isJsxPath(a.file) })
            : undefined;
        const range = span ? ` (lines ${span.bodyStartLine + 1}-${span.endLine - 1})` : "";
        placeholder(`${at}.line`, `${at}.line is 0; set it to the line of a security check in the body of \`${String(a.symbol)}\`${range}.`);
      }
      if (a.check === "") placeholder(`${at}.check`, `${at}.check is empty; write one sentence on what the cited line prevents.`);
    });
  }

  // Core checks: shape first, then the answers against the committed code.
  const core: ScanIssue[] = [];
  const parsed = parseAttestation(draft);
  if (!parsed.ok) core.push(...parsed.issues);
  const answers = Array.isArray(draft.answers) ? draft.answers : undefined;
  if (answers && answers.every(isLooseAnswer)) {
    core.push(...checkAnswers(answers as AttestationAnswer[], challenge.functions, files));
  }
  const seen = new Set<string>();
  for (const issue of core) {
    const key = `${issue.path}\n${issue.message}`;
    if (placeholderPaths.has(issue.path) || seen.has(key)) continue;
    seen.add(key);
    push(issue.path, issue.message);
  }

  if (deps.now() >= Date.parse(challenge.expiresAt)) {
    push("challenge", `The challenge expired at ${challenge.expiresAt}; run \`pnpm scan start\` again and copy your answers into the new ${ATTESTATION_FILE}.`);
  }
  if (issues.length > 0 || !parsed.ok) return { ok: false, command: "finish", lines: notes, issues, json: {} };

  // Local checks pass, so ask the server (latest release, unexpired and unused challenge).
  const attestation = parsed.attestation;
  const sent = await callApi(
    deps,
    "/attestations/check",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attestation }) },
    "pnpm scan finish",
  );
  if (!sent.ok) return { ok: false, command: "finish", lines: notes, issues: sent.issues, json: {} };
  const result = sent.body as { attestationId?: unknown; paidPlacesLeft?: unknown } | null;
  const id = await attestationId(attestation);
  if (typeof result?.attestationId !== "string" || result.attestationId !== id) {
    return fail("finish", [
      { path: "attestationId", message: "The server computed a different attestation id than this checkout; update the checkout (`git pull`) and run `pnpm scan finish` again." },
    ]);
  }
  const paidPlacesLeft = typeof result.paidPlacesLeft === "number" ? result.paidPlacesLeft : undefined;

  await writeJson(deps, ATTESTATION_FILE, attestation);
  const startedAt = Number((await readText(deps, STARTED_FILE))?.trim());
  const elapsedMs = Number.isFinite(startedAt) && startedAt > 0 ? deps.now() - startedAt : undefined;
  const link = `${deps.siteUrl.replace(/\/*$/, "/")}attest.html#${encodeAttestationPayload(attestation)}`;
  const lines = [
    ...notes,
    `Attestation valid for Gleam v${attestation.release}.`,
    `Attestation id: ${id}`,
    ...(elapsedMs === undefined ? [] : [`Scan time: ${formatElapsed(elapsedMs)}.`]),
    ...(paidPlacesLeft === undefined ? [] : [`Paid places left: ${paidPlacesLeft}`]),
    ...(paidPlacesLeft === 0 ? ["Warning: no paid places are left, so this scan will be recorded but earns no points."] : []),
    `Once the user has signed, put the attestation id ${id} in every PR and advisory you draft for this scan.`,
    `Link: ${link}`,
    `Tell the user: ${USER_MESSAGE}`,
  ];
  return {
    ok: true,
    command: "finish",
    lines,
    issues: [],
    json: { challenge: challenge.challenge, attestationId: id, link, userMessage: USER_MESSAGE, ...(elapsedMs === undefined ? {} : { elapsedMs, elapsed: formatElapsed(elapsedMs) }), ...(paidPlacesLeft === undefined ? {} : { paidPlacesLeft }) },
  };
}

function fill(draft: Record<string, unknown>, key: "release" | "commit", value: string, notes: string[]): void {
  const old = draft[key];
  if (old !== undefined && old !== "" && old !== value) {
    notes.push(`Replaced ${key} ${JSON.stringify(old)} with ${value} from git.`);
  }
  draft[key] = value;
}

function isLooseAnswer(value: unknown): boolean {
  const a = value as Record<string, unknown> | null;
  return a !== null && typeof a === "object" && typeof a.file === "string" && typeof a.symbol === "string" && typeof a.line === "number";
}
