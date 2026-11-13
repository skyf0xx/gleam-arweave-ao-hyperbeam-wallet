// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encodeAttestationPayload, parseAttestation, type ScanAreaId } from "../../packages/core/src/scan/index.ts";
import { main, render } from "./cli.ts";
import { UNKNOWN, exists, fakeApi, finishedAttestation, goodAttestation, idOf, json, makeDeps, put, readJsonFile, writeRound, type Handler } from "./harness.ts";
import { runNext, type NextResponse } from "./next.ts";
import { CLOSING_HEADER, type Deps } from "./shared.ts";

const NEXT: NextResponse = {
  release: "1.4.0",
  area: "keys",
  round: 1,
  points: "12400000000000",
  nextRound: 2,
  nextRewardAtomic: "13640000000000",
  nextPaid: true,
  areasLeft: [
    { id: "boundary", label: "Trust boundary", functions: 137, examined: 40 },
    { id: "signing", label: "Signing", functions: 50, examined: 30 },
  ],
  suggested: "boundary",
};

/** `/scan/next` answers per attestation id; an id missing from `signed` is unknown. */
function nextApi(signed: Record<string, NextResponse>, calls: string[] = []): typeof fetch {
  const handler: Handler = (url) => {
    const answer = signed[url.searchParams.get("attestation") ?? ""];
    return answer ? json(answer) : json(UNKNOWN, 404);
  };
  return fakeApi({ "/scan/next": handler }, calls);
}

async function waitingRound(deps: Deps, area: ScanAreaId, startedAt: number, files: Record<string, string> = {}): Promise<string> {
  const attestation = finishedAttestation(area);
  writeRound(deps, area, { attestation, finished: true, startedAt, files });
  return idOf(attestation);
}

function payload(area: ScanAreaId): string {
  const parsed = parseAttestation(finishedAttestation(area));
  if (!parsed.ok) throw new Error("fixture doesn't parse");
  return encodeAttestationPayload(parsed.attestation);
}

describe("pnpm scan next", () => {
  it("records each signed round and ends with the offer from the last one", async () => {
    const deps = makeDeps();
    const keys = await waitingRound(deps, "keys", 1);
    const signing = await waitingRound(deps, "signing", 2);
    const calls: string[] = [];
    deps.fetchImpl = nextApi(
      {
        [keys]: { ...NEXT, round: 1 },
        [signing]: { ...NEXT, area: "signing", round: 2, points: "13640000000000", nextRound: 3, nextRewardAtomic: "14880000000000", areasLeft: [NEXT.areasLeft[0]!] },
      },
      calls,
    );
    const outcome = await runNext(deps);
    expect(outcome.ok).toBe(true);
    expect(calls).toEqual([`/scan/next?attestation=${keys}`, `/scan/next?attestation=${signing}`]);
    expect(render(outcome, false).split("\n")).toEqual([
      `✓ Round 1 (Key material) is signed: 12.40 points. Attestation id ${keys}; drafts in .gleam-scan/rounds/keys/.`,
      `Round 2 (Signing) is signed: 13.64 points. Attestation id ${signing}; drafts in .gleam-scan/rounds/signing/.`,
      "",
      CLOSING_HEADER,
      "",
      'Signed: 2 rounds earned 26.04 points. Round 3 earns 14.88 points even with no findings, and nobody has examined 97 of the 137 functions in Trust boundary yet. Reply "next" to scan it.',
    ]);
    expect(readJsonFile(deps, ".gleam-scan/rounds/signing/signed.json")).toEqual({ attestationId: signing, round: 2, points: "13640000000000" });
  });

  it("ends with the sign request for the rounds still unsigned", async () => {
    const deps = makeDeps();
    const keys = await waitingRound(deps, "keys", 1, { "pr-1.md": "x" });
    await waitingRound(deps, "signing", 2, { "advisory-1.md": "Title: x", "pr-1.md": "y" });
    await waitingRound(deps, "preview", 3);
    deps.fetchImpl = nextApi({ [keys]: NEXT });
    const outcome = await runNext(deps);
    expect(outcome.ok).toBe(false);
    const out = render(outcome, false).split("\n");
    expect(out[0]).toBe(
      "✗ unsigned: Signing and Approval preview aren't signed yet; file only the drafts of the signed rounds, and end the turn with the sign request below.",
    );
    expect(out.slice(-6)).toEqual([
      CLOSING_HEADER,
      "",
      "2 rounds are ready to sign, with 2 reports to file.",
      "",
      `1. Open this link and sign each round in Gleam: https://site.test/attest.html#${payload("signing")}.${payload("preview")}`,
      '2. Reply "signed" and I\'ll file the reports: fork, push, open each PR and file each advisory.',
    ]);
    expect(exists(deps, ".gleam-scan/rounds/keys/signed.json")).toBe(true);
    expect(exists(deps, ".gleam-scan/rounds/signing/signed.json")).toBe(false);
  });

  it("checks unsigned rounds again, and names the fix for a dead one instead of linking it", async () => {
    const deps = makeDeps({ now: () => Date.parse("2026-10-20T00:00:00Z") });
    const keys = await waitingRound(deps, "keys", 1);
    await waitingRound(deps, "signing", 2);
    deps.fetchImpl = nextApi({ [keys]: NEXT });
    const outcome = await runNext(deps);
    expect(outcome.ok).toBe(false);
    const out = render(outcome, false).split("\n");
    expect(out[0]).toBe(
      "✗ signing challenge: The challenge expired at 2026-10-19T00:00:00.000Z; run `pnpm scan start --area signing`, answer its 3 new functions, copy model, result and report from the backup it names, then run `pnpm scan finish --area signing` and `pnpm scan next` again.",
    );
    expect(out[1]).toMatch(/^Round 1 \(Key material\) is signed: 12\.40 points\./);
    expect(out).not.toContain(CLOSING_HEADER);
    expect(exists(deps, ".gleam-scan/rounds/signing/finished.json")).toBe(false);
    expect(exists(deps, ".gleam-scan/rounds/keys/signed.json")).toBe(true);
  });

  it("stops without dropping a round when the re-check hits a server error", async () => {
    const deps = makeDeps({ fetchImpl: fakeApi({ "/scan/next": () => json(UNKNOWN, 404), "/attestations/check": () => json({}, 503) }) });
    await waitingRound(deps, "keys", 1);
    expect(render(await runNext(deps), false)).toBe("✗ http_503: The points API had a server error (503); wait a few minutes, then run `pnpm scan next` again.");
    expect(exists(deps, ".gleam-scan/rounds/keys/finished.json")).toBe(true);
  });

  it("clears the decline count once a round is signed, and shows it while none is", async () => {
    const deps = makeDeps();
    const keys = await waitingRound(deps, "keys", 1);
    put(deps, ".gleam-scan/declines", "3\n");
    expect(render(await runNext(deps), false)).toContain("Unanswered sign requests so far: 3 (.gleam-scan/declines).");
    deps.fetchImpl = nextApi({ [keys]: NEXT });
    await runNext(deps);
    expect(exists(deps, ".gleam-scan/declines")).toBe(false);
  });

  it("asks to add the ids once the unsigned round's reports are filed without them", async () => {
    const deps = makeDeps();
    await waitingRound(deps, "keys", 1, { "pr-1.md": "x", "filed.txt": "pr-1.md https://github.com/x/pull/9\n" });
    const out = render(await runNext(deps), false).split("\n");
    expect(out.slice(-4)).toEqual([
      "1 round is ready to sign.",
      "",
      `1. Open this link and sign it in Gleam: https://site.test/attest.html#${payload("keys")}`,
      '2. Reply "signed" and I\'ll add the attestation id to the filed report.',
    ]);
  });

  it("prints the same offer again when nothing is waiting", async () => {
    const deps = makeDeps();
    const keys = await idOf(finishedAttestation("keys"));
    writeRound(deps, "keys", { attestation: finishedAttestation("keys"), signed: { attestationId: keys, round: 1, points: "12400000000000" } });
    const calls: string[] = [];
    deps.fetchImpl = nextApi({ [keys]: NEXT }, calls);
    expect(render(await runNext(deps), false).split("\n")).toEqual([
      "✓ 1 round of Gleam v1.4.0 signed in this checkout.",
      "",
      CLOSING_HEADER,
      "",
      'Signed: 1 round earned 12.40 points. Round 2 earns 13.64 points even with no findings, and nobody has examined 97 of the 137 functions in Trust boundary yet. Reply "next" to scan it.',
    ]);
    expect(calls).toEqual([`/scan/next?attestation=${keys}`]);
  });

  it("prints the same closing message when run again right after signing", async () => {
    const deps = makeDeps();
    const keys = await waitingRound(deps, "keys", 1);
    deps.fetchImpl = nextApi({ [keys]: NEXT });
    const first = await runNext(deps);
    const again = await runNext(deps);
    expect(again.json.userMessage).toBe(first.json.userMessage);
  });

  it("skips an area that has an open round here, and still offers a round once the paid places are gone", async () => {
    const deps = makeDeps();
    const keys = await waitingRound(deps, "keys", 1);
    writeRound(deps, "boundary", { attestation: goodAttestation({}, "boundary"), startedAt: 2 });
    deps.fetchImpl = nextApi({ [keys]: { ...NEXT, nextPaid: false, nextRewardAtomic: "0" } });
    expect(render(await runNext(deps), false).split("\n").at(-1)).toBe(
      'Signed: 1 round earned 12.40 points. Round 2 is recorded but earns no points, and nobody has examined 20 of the 50 functions in Signing yet. Reply "next" to scan it.',
    );
  });

  it("says when the wallet has no area left", async () => {
    const deps = makeDeps();
    const keys = await waitingRound(deps, "keys", 1);
    deps.fetchImpl = nextApi({ [keys]: { ...NEXT, points: "0", areasLeft: [], suggested: null } });
    expect(render(await runNext(deps), false).split("\n").at(-1)).toBe(
      "Signed: 1 round earned no points. This wallet has scanned every area of v1.4.0; the next release opens new rounds.",
    );
  });

  it("asks for file first when no round waits", async () => {
    expect(render(await runNext(makeDeps()), false)).toBe("✗ rounds: No round is waiting to be signed; run `pnpm scan file` and have the user sign first.");
  });

  it("stops on a server error other than an unknown attestation", async () => {
    const deps = makeDeps({ fetchImpl: fakeApi({ "/scan/next": () => json({}, 502) }) });
    await waitingRound(deps, "keys", 1);
    expect(render(await runNext(deps), false)).toBe("✗ http_502: The points API had a server error (502); wait a few minutes, then run `pnpm scan next` again.");
    const odd = makeDeps({ fetchImpl: fakeApi({ "/scan/next": () => json({ ...NEXT, points: 12.4 }) }) });
    await waitingRound(odd, "keys", 1);
    expect(render(await runNext(odd), false)).toMatch(/^✗ next: The points API sent the next round in an unexpected shape;/);
  });

  it("--json prints one object with the closing message", async () => {
    const deps = makeDeps();
    const keys = await waitingRound(deps, "keys", 1);
    deps.fetchImpl = nextApi({ [keys]: NEXT });
    const out: string[] = [];
    expect(await main(["next", "--json"], deps, { out: (t) => out.push(t), tty: false })).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]!);
    expect(parsed).toMatchObject({ ok: true, command: "next", nextRound: 2, suggested: "boundary", closingHeader: CLOSING_HEADER });
    expect(parsed.userMessage).toMatch(/^Signed: 1 round earned 12\.40 points\./);
  });
});
