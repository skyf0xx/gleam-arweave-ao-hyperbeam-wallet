// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attestationId, decodeAttestationPayload } from "../../packages/core/src/scan/index.ts";
import { main, render, renderJson } from "./cli.ts";
import { runFinish } from "./finish.ts";
import { CHALLENGE, COMMIT, FUNCTIONS, fakeGit, goodAttestation, json, makeDeps, readJsonFile } from "./harness.ts";
import type { Deps } from "./shared.ts";

function setup(attestation: unknown, overrides: Partial<Deps> = {}, raw?: string): Deps {
  const deps = makeDeps(overrides);
  mkdirSync(join(deps.root, ".gleam-scan"));
  writeFileSync(join(deps.root, ".gleam-scan/challenge.json"), JSON.stringify(CHALLENGE));
  writeFileSync(join(deps.root, ".gleam-scan/attestation.json"), raw ?? JSON.stringify(attestation));
  return deps;
}

const accepted = (id: string, paidPlacesLeft = 7) =>
  (async () => json({ ok: true, attestationId: id, message: "gleam-points:attest:v1:1.4.0:" + id, paidPlacesLeft })) as typeof fetch;

async function lines(deps: Deps): Promise<string[]> {
  return render(await runFinish(deps), false).split("\n");
}

describe("pnpm scan finish: local checks", () => {
  it("asks for start when there is no challenge or attestation", async () => {
    const empty = makeDeps();
    expect(await lines(empty)).toEqual(["✗ .gleam-scan/challenge.json: There is no challenge yet; run `pnpm scan start` first."]);
    const deps = makeDeps();
    mkdirSync(join(deps.root, ".gleam-scan"));
    writeFileSync(join(deps.root, ".gleam-scan/challenge.json"), JSON.stringify(CHALLENGE));
    expect(await lines(deps)).toEqual(["✗ .gleam-scan/attestation.json: There is no attestation file; run `pnpm scan start` first."]);
  });

  it("names the line and column of bad JSON", async () => {
    const deps = setup(undefined, {}, '{\n  "model": "x",\n  oops\n}');
    const [line] = await lines(deps);
    expect(line).toMatch(/^✗ \.gleam-scan\/attestation\.json: \.gleam-scan\/attestation\.json isn't valid JSON at line 3, column 3;/);
  });

  it("flags the starter placeholders with targeted lines", async () => {
    const starter = {
      challenge: CHALLENGE.challenge,
      model: "",
      answers: FUNCTIONS.map((fn) => ({ ...fn, line: 0, check: "" })),
      result: "pass",
      report: "",
    };
    const out = await lines(setup(starter));
    expect(out).toContain("✗ model: model is empty; set it to your model name, such as claude-opus-5-5.");
    expect(out).toContain("✗ report: report is empty; write markdown on what you checked and what you didn't.");
    expect(out).toContain("✗ answers[0].line: answers[0].line is 0; set it to the line of a security check in the body of `unlockVault` (lines 8-16).");
    expect(out).toContain("✗ answers[2].check: answers[2].check is empty; write one sentence on what the cited line prevents.");
    expect(out).toHaveLength(2 + 3 * 2);
  });

  it("surfaces core answer issues, one line each", async () => {
    const attestation = goodAttestation();
    const answers = attestation.answers as { line: number; symbol: string }[];
    answers[0]!.line = 12 - 1; // a comment line inside unlockVault
    answers[1]!.line = 1;
    answers[2]!.symbol = "nope";
    const out = await lines(setup(attestation));
    expect(out.every((line) => line.startsWith("✗ "))).toBe(true);
    expect(out.join("\n")).toContain("answers[0].line 11 is a comment");
    expect(out.join("\n")).toContain("answers[1].line 1 is outside `isAllowedOrigin`");
    expect(out.join("\n")).toContain("answers[2]");
  });

  it("surfaces shape issues from parseAttestation", async () => {
    const out = await lines(setup(goodAttestation({ result: "maybe", extra: 1 })));
    expect(out).toContain('✗ result: result must be "pass" if you filed nothing, or "scanned" if you filed a PR or an advisory.');
    expect(out).toContain("✗ extra: extra isn't part of the attestation format; remove it.");
  });

  it("fails on an expired challenge and on a HEAD that isn't the release", async () => {
    const expired = setup(goodAttestation(), { now: () => Date.parse("2026-10-18T00:00:00Z") });
    expect((await lines(expired)).join("\n")).toContain("The challenge expired at 2026-10-17T00:00:00.000Z; run `pnpm scan start` again");
    const moved = setup(goodAttestation(), { git: fakeGit({ head: "e".repeat(40), tags: [] }) });
    const out = (await lines(moved)).join("\n");
    expect(out).toContain("has no v<x.y.z> release tag; run `git checkout v1.4.0`");
    expect(out).toContain("HEAD is eeeeeee but the challenge is for v1.4.0 (ccccccc)");
  });

  it("does not call the server when a local check fails", async () => {
    let calls = 0;
    const deps = setup(goodAttestation({ report: "" }), {
      fetchImpl: (async () => { calls++; return json({}); }) as typeof fetch,
    });
    await runFinish(deps);
    expect(calls).toBe(0);
  });
});

describe("pnpm scan finish: server and output", () => {
  it("prints server issues the same way", async () => {
    const deps = setup(goodAttestation(), {
      fetchImpl: (async () =>
        json({ error: "x", code: "release_not_latest", issues: [{ code: "release_not_latest", path: "release", message: "v1.4.0 isn't the latest release; check out v1.5.0, run `pnpm scan start` and answer again." }] }, 409)) as typeof fetch,
    });
    expect(await lines(deps)).toEqual(["✗ release: v1.4.0 isn't the latest release; check out v1.5.0, run `pnpm scan start` and answer again."]);
  });

  it("explains a network failure and a 429 in one sentence", async () => {
    const down = setup(goodAttestation(), { fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    expect(await lines(down)).toEqual([
      "✗ network: Couldn't reach https://api.test (fetch failed); check the connection and run `pnpm scan finish` again.",
    ]);
    const limited = setup(goodAttestation(), { fetchImpl: (async () => json({ code: "rate_limited" }, 429, { "Retry-After": "42" })) as typeof fetch });
    expect(await lines(limited)).toEqual([
      "✗ rate_limited: The points API is rate limiting this address; wait 42 seconds, then run `pnpm scan finish` again.",
    ]);
  });

  it("on success fills release and commit, prints a link that decodes back, and rewrites the file", async () => {
    const stale = goodAttestation({ release: "0.9.0", commit: "f".repeat(40) });
    const deps = setup(stale);
    // The server answers with the id of what it received.
    let id = "";
    deps.fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const { attestation } = JSON.parse(String(init?.body)) as { attestation: Parameters<typeof attestationId>[0] };
      id = await attestationId(attestation);
      return accepted(id)(_url as string, init);
    }) as typeof fetch;
    const outcome = await runFinish(deps);
    expect(outcome.ok).toBe(true);
    const text = render(outcome, false);
    expect(text).toContain('Replaced release "0.9.0" with 1.4.0 from git.');
    expect(text).toContain(`Attestation id: ${id}`);
    expect(text).toContain("Paid places left: 7");
    expect(text).toContain(`Put the attestation id ${id} in every PR and advisory`);
    expect(text).toContain("Tell the user: Open this link in Chrome with Gleam installed and click Sign with Gleam; it signs no transaction and moves no funds.");

    const link = /^Link: (.+)$/m.exec(text)![1]!;
    expect(link.startsWith("https://site.test/attest.html#")).toBe(true);
    const decoded = decodeAttestationPayload(link.split("#")[1]!);
    if (!decoded.ok) throw new Error("link did not decode");
    expect(decoded.attestation).toMatchObject({ release: "1.4.0", commit: COMMIT });
    expect(await attestationId(decoded.attestation)).toBe(id);
    expect(readJsonFile(deps, ".gleam-scan/attestation.json")).toMatchObject({ release: "1.4.0", commit: COMMIT });
  });

  it("warns, without failing, when no paid places are left", async () => {
    const deps = setup(goodAttestation());
    deps.fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const { attestation } = JSON.parse(String(init?.body)) as { attestation: Parameters<typeof attestationId>[0] };
      return accepted(await attestationId(attestation), 0)(_url as string, init);
    }) as typeof fetch;
    const outcome = await runFinish(deps);
    expect(outcome.ok).toBe(true);
    expect(render(outcome, false)).toContain("Warning: no paid places are left, so this scan will be recorded but earns no points.");
  });

  it("fails when the server's id differs from the local one", async () => {
    const deps = setup(goodAttestation(), { fetchImpl: accepted("0".repeat(64)) });
    expect((await lines(deps))[0]).toContain("The server computed a different attestation id");
  });

  it("--json prints exactly one object on stdout", async () => {
    const good = setup(goodAttestation());
    good.fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const { attestation } = JSON.parse(String(init?.body)) as { attestation: Parameters<typeof attestationId>[0] };
      return accepted(await attestationId(attestation))(_url as string, init);
    }) as typeof fetch;
    const out: string[] = [];
    expect(await main(["finish", "--json"], good, { out: (t) => out.push(t), tty: true })).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]!);
    expect(Object.keys(parsed).sort()).toEqual(["attestationId", "challenge", "command", "link", "ok", "paidPlacesLeft", "userMessage"]);
    expect(parsed).toMatchObject({ ok: true, command: "finish", paidPlacesLeft: 7 });
    expect(out[0]).not.toContain("\u001b");

    const bad = setup(goodAttestation({ report: "" }));
    const failed: string[] = [];
    expect(await main(["finish", "--json"], bad, { out: (t) => failed.push(t), tty: true })).toBe(1);
    expect(JSON.parse(failed[0]!)).toEqual({
      ok: false,
      command: "finish",
      issues: [{ path: "report", message: "report is empty; write markdown on what you checked and what you didn't." }],
    });
    expect(renderJson({ ok: true, command: "start", lines: [], issues: [], json: {} })).toBe('{"ok":true,"command":"start"}');
  });

  it("rejects an unknown subcommand with usage", async () => {
    const out: string[] = [];
    expect(await main(["bogus"], makeDeps(), { out: (t) => out.push(t), tty: false })).toBe(1);
    expect(out[0]).toContain("Usage: pnpm scan start | pnpm scan finish [--json]");
  });
});

describe("pnpm scan finish: real run", () => {
  const repo = join(import.meta.dirname, "../..");
  it.skipIf(existsSync(join(repo, ".gleam-scan")))("with no .gleam-scan/ prints the start-first line and exits 1", () => {
    const run = spawnSync("pnpm", ["--silent", "scan", "finish"], { cwd: repo, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe("✗ .gleam-scan/challenge.json: There is no challenge yet; run `pnpm scan start` first.");
  });

  it("--json from an empty directory is one JSON line", () => {
    const empty = mkdtempSync(join(tmpdir(), "gleam-scan-empty-"));
    const tsx = join(repo, "node_modules/.bin/tsx");
    const run = spawnSync(tsx, [join(repo, "scripts/scan/cli.ts"), "finish", "--json"], { cwd: empty, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: false, command: "finish" });
  });
});
