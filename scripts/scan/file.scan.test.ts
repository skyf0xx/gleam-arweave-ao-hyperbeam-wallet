// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeAttestationPayload, type ScanAreaId } from "../../packages/core/src/scan/index.ts";
import { main, render } from "./cli.ts";
import { runFile } from "./file.ts";
import { acceptCheck, exists, fakeApi, finishedAttestation, goodAttestation, idOf, json, makeDeps, put, readJsonFile, writeRound } from "./harness.ts";
import type { NextResponse } from "./next.ts";
import { CLOSING_HEADER, type Deps } from "./shared.ts";

async function waitingRound(deps: Deps, area: ScanAreaId, startedAt: number, files: Record<string, string> = {}): Promise<string> {
  const attestation = finishedAttestation(area);
  writeRound(deps, area, { attestation, finished: true, startedAt, files });
  return idOf(attestation);
}

describe("pnpm scan file", () => {
  it("re-checks every waiting round and ends with one link that signs them in round order", async () => {
    const deps = makeDeps();
    const keys = await waitingRound(deps, "keys", 1, { "pr-1.md": "x" });
    const boundary = await waitingRound(deps, "boundary", 2, { "advisory-1.md": "Title: A site can read balances\nShort.", "pr-1.md": "y", "pr-2.md": "z" });
    writeRound(deps, "signing", { attestation: goodAttestation({}, "signing"), startedAt: 3 });
    const calls: string[] = [];
    deps.fetchImpl = fakeApi({}, calls);
    const outcome = await runFile(deps);
    expect(outcome.ok).toBe(true);
    expect(calls).toEqual(["/attestations/check", "/attestations/check"]);
    const link = String(outcome.json.link);
    expect(render(outcome, false).split("\n")).toEqual([
      `✓ Round 1 (Key material): attestation ${keys}, drafts in .gleam-scan/rounds/keys/.`,
      `Round 2 (Trust boundary): attestation ${boundary}, drafts in .gleam-scan/rounds/boundary/.`,
      "",
      CLOSING_HEADER,
      "",
      "2 rounds are ready to sign, with 4 reports to file.",
      "",
      `1. Open this link and sign each round in Gleam: ${link}`,
      '2. Reply "signed" and I\'ll file the reports: fork, push, open each PR and file each advisory.',
    ]);
    const payloads = link.split("#")[1]!.split(".");
    expect(payloads).toHaveLength(2);
    expect(decodeAttestationPayload(payloads[1]!)).toMatchObject({ ok: true, attestation: { challenge: "B".repeat(22) } });
    expect(outcome.json).toMatchObject({ rounds: [{ area: "keys", round: 1, attestationId: keys }, { area: "boundary", round: 2, attestationId: boundary }] });
  });

  it("words one round and a clean pass", async () => {
    const deps = makeDeps();
    await waitingRound(deps, "keys", 1);
    const out = render(await runFile(deps), false).split("\n");
    expect(out.slice(-4, -2)).toEqual(["1 round is ready to sign.", ""]);
    expect(out.at(-2)).toMatch(/^1\. Open this link and sign it in Gleam: https:\/\/site\.test\/attest\.html#[A-Za-z0-9_-]+$/);
    expect(out.at(-1)).toBe('2. Reply "signed" when you\'re done.');
  });

  it("names the round and the fix for an expired challenge, and reopens that round", async () => {
    const deps = makeDeps({ now: () => Date.parse("2026-10-20T00:00:00Z") });
    await waitingRound(deps, "signing", 1);
    const outcome = await runFile(deps);
    expect(outcome.ok).toBe(false);
    expect(render(outcome, false)).toBe(
      "✗ signing challenge: The challenge expired at 2026-10-19T00:00:00.000Z; run `pnpm scan start --area signing`, answer its 3 new functions, copy model, result and report from the backup it names, then run `pnpm scan finish --area signing` and `pnpm scan file` again.",
    );
    expect(exists(deps, ".gleam-scan/rounds/signing/finished.json")).toBe(false);
  });

  it("records a round whose challenge is used because the user signed it already", async () => {
    const deps = makeDeps();
    const keys = await waitingRound(deps, "keys", 1);
    await waitingRound(deps, "signing", 2);
    const used = { error: "x", code: "challenge_used", issues: [{ code: "challenge_used", path: "challenge", message: "This challenge was already used; run `pnpm scan start` for a new one." }] };
    const signed: NextResponse = { release: "1.4.0", area: "keys", round: 1, points: "5", nextRound: 2, nextRewardAtomic: "0", nextPaid: false, areasLeft: [], suggested: null };
    deps.fetchImpl = fakeApi({
      "/attestations/check": async (url, init) => (String(init?.body).includes("Q".repeat(22)) ? json(used, 409) : acceptCheck()(url, init)),
      "/scan/next": () => json(signed),
    });
    const out = render(await runFile(deps), false).split("\n");
    expect(out[0]).toBe("✓ The Key material round is signed already; `pnpm scan next` reports it.");
    expect(out[1]).toMatch(/^Round 2 \(Signing\): attestation /);
    expect(out).toContain("1 round is ready to sign.");
    expect(readJsonFile(deps, ".gleam-scan/rounds/keys/signed.json")).toEqual({ attestationId: keys, round: 1, points: "5" });
  });

  it("keeps a round waiting when the server can't be reached or errors", async () => {
    const deps = makeDeps({ fetchImpl: fakeApi({ "/attestations/check": () => json({}, 502) }) });
    await waitingRound(deps, "keys", 1);
    expect(render(await runFile(deps), false)).toBe("✗ keys http_502: The points API had a server error (502); wait a few minutes, then run `pnpm scan file` again.");
    expect(exists(deps, ".gleam-scan/rounds/keys/finished.json")).toBe(true);
    deps.fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await runFile(deps);
    expect(exists(deps, ".gleam-scan/rounds/keys/finished.json")).toBe(true);
    deps.fetchImpl = fakeApi();
    expect(render(await runFile(deps), false)).toContain("1 round is ready to sign.");
  });

  it("shows the unanswered sign requests counted on disk", async () => {
    const deps = makeDeps();
    await waitingRound(deps, "keys", 1);
    put(deps, ".gleam-scan/declines", "2\n");
    const out = render(await runFile(deps), false).split("\n");
    expect(out[out.indexOf(CLOSING_HEADER) - 2]).toBe("Unanswered sign requests so far: 2 (.gleam-scan/declines).");
  });

  it("says what to run when nothing waits", async () => {
    expect(render(await runFile(makeDeps()), false)).toBe(
      "✗ rounds: No round has passed `pnpm scan finish` yet; fill in the round's attestation and run `pnpm scan finish` first.",
    );
    const deps = makeDeps();
    writeRound(deps, "keys", { signed: { attestationId: "a".repeat(64), round: 1, points: "0" } });
    expect(render(await runFile(deps), false)).toBe("✗ rounds: Every round in this checkout is signed; run `pnpm scan next`.");
  });

  it("--json carries the rounds, the link and the closing message", async () => {
    const deps = makeDeps();
    await waitingRound(deps, "keys", 1);
    const out: string[] = [];
    expect(await main(["file", "--json"], deps, { out: (t) => out.push(t), tty: false })).toBe(0);
    const parsed = JSON.parse(out[0]!);
    expect(parsed).toMatchObject({ ok: true, command: "file", closingHeader: CLOSING_HEADER });
    expect(parsed.userMessage).toBe(["1 round is ready to sign.", "", `1. Open this link and sign it in Gleam: ${parsed.link}`, '2. Reply "signed" when you\'re done.'].join("\n"));
  });
});
