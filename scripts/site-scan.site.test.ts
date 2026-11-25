import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  MIN_PAID_SCANS_PER_MINOR_RELEASE as CORE_MIN_PAID_SCANS_PER_MINOR_RELEASE,
  MIN_PAID_SCANS_PER_RELEASE as CORE_MIN_PAID_SCANS_PER_RELEASE,
  PAID_SCANS_PER_RELEASE as CORE_PAID_SCANS_PER_RELEASE,
  ROUND_STEP_PERCENT as CORE_ROUND_STEP_PERCENT,
  SCAN_AREAS as CORE_SCAN_AREAS,
  encodeAttestationPayload,
} from "../packages/core/src/scan/index";
import {
  AGENT_LINE,
  DEV_EXTENSION_KEY,
  EXTENSION_ID,
  ROUND_STEP_PERCENT,
  SCAN_AREAS,
  STORE_EXTENSION_ID,
  areaLabel,
  areaRows,
  coverageSummary,
  extensionIdFor,
  formatPoints,
  idFromHash,
  releaseFromSearch,
  roundLabel,
  roundStepPercent,
  unusedModels,
} from "../apps/site/scan-lib.js";
import {
  appAttestHref,
  decodeAttestationFragment,
  decodeAttestationLink,
  describeOutcome,
  isFinal,
  roundSummary,
  sendAttestation,
  sumPoints,
  checkGleam,
} from "../apps/site/scan-attest.js";
import {
  MIN_PAID_SCANS_PER_MINOR_RELEASE,
  MIN_PAID_SCANS_PER_RELEASE,
  PAID_SCANS_PER_RELEASE,
  bountyTiers,
  fetchAreas,
  fetchCount,
  fetchListing,
  fetchRewards,
  nextScanReward,
  placesOf,
  resultsHref,
} from "../apps/site/scan-api.js";

/** A decoded round, as `decodeAttestationLink` documents it (the site lib is plain JS). */
type Round = { ok: true; payload: string; attestation: { report: string } } | { ok: false; payload: string; error: string };

const attestation = {
  release: "1.4.0",
  commit: "a".repeat(40),
  model: "claude-opus-5-5",
  challenge: "c".repeat(22),
  answers: [{ file: "packages/core/src/x.ts", symbol: "check", line: 12, check: "Rejects a negative amount before signing." }],
  result: "pass" as const,
  report: "Checked the signer. Didn't look at é <img src=x onerror=alert(1)> or the popup.",
};

describe("site pages", () => {
  it.each(["attest", "scan", "review-results"])("%s.html has every element its script looks up", (name) => {
    const script = readFileSync(`apps/site/${name}.js`, "utf8");
    const page = readFileSync(`apps/site/${name}.html`, "utf8");
    const attributes = [...script.matchAll(/\$\("\[(data-[a-z-]+)\]"\)/g)].map(([, attribute]) => attribute!);
    expect(attributes.length).toBeGreaterThan(0);
    // A lookup that misses throws before the page wires up the rest.
    expect(attributes.filter((attribute) => !page.includes(attribute))).toEqual([]);
  });
});

describe("site scan lib: link payload", () => {
  it("decodes what core encodes, including non-ASCII text", () => {
    const hash = `#${encodeAttestationPayload(attestation as never)}`;
    const decoded = decodeAttestationFragment(hash);
    expect(decoded).toEqual({ ok: true, attestation });
  });

  it("rejects anything that isn't base64url JSON of an attestation", () => {
    const bad = (hash: string) => expect(decodeAttestationFragment(hash).ok).toBe(false);
    bad("");
    bad("#not base64!");
    bad("#e30"); // {}
    bad(`#${btoa("[]").replace(/=+$/, "")}`);
    bad(`#${btoa("\xff\xfe").replace(/=+$/, "")}`); // invalid UTF-8
    bad(`#${btoa(JSON.stringify({ ...attestation, result: "fail" })).replace(/=+$/, "")}`);
    bad(`#${btoa(JSON.stringify({ ...attestation, answers: [{ file: 1 }] })).replace(/=+$/, "")}`);
  });
});

describe("site scan lib: a link with several rounds", () => {
  const payload = (report: string) => encodeAttestationPayload({ ...attestation, report } as never);
  const reports = ["## Coverage\n\nArea: Key material (tier 1).", "Area: Signing (tier 2).", "- **Area:** `Trust boundary`"];

  it("decodes each payload in order, and a single payload as one round", () => {
    const parts = reports.map(payload);
    const decoded = decodeAttestationLink(`#${parts.join(".")}`);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.rounds.map((round: Round) => (round.ok ? round.attestation.report : false))).toEqual(reports);
    expect(decoded.rounds.map((round: Round) => round.payload)).toEqual(parts);
    expect(decodeAttestationLink(`#${parts[0]}`)).toEqual({ ok: true, rounds: [{ ok: true, payload: parts[0], attestation: { ...attestation, report: reports[0] } }] });
  });

  it("marks one bad payload as a damaged round and keeps the others", () => {
    const decoded = decodeAttestationLink(`#${payload(reports[0]!)}.e30.${payload(reports[1]!)}`);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.rounds.map((round: Round) => round.ok)).toEqual([true, false, true]);
    expect(decoded.rounds[1]).toMatchObject({ ok: false, payload: "e30", error: expect.stringMatching(/damaged/) });
  });

  it("rejects a link with too many rounds, an empty round, or no round that decodes", () => {
    const tooMany = decodeAttestationLink(`#${Array.from({ length: SCAN_AREAS.length + 1 }, () => payload("x")).join(".")}`);
    expect(tooMany).toEqual({ ok: false, error: expect.stringMatching(/more rounds than a release has areas/) });
    expect(decodeAttestationLink(`#${Array.from({ length: SCAN_AREAS.length }, () => payload("x")).join(".")}`).ok).toBe(true);
    expect(decodeAttestationLink(`#${payload("x")}.`).ok).toBe(false);
    expect(decodeAttestationLink(`#${payload("x")}..${payload("y")}`).ok).toBe(false);
    expect(decodeAttestationLink("#e30.e30").ok).toBe(false);
    expect(decodeAttestationLink("").ok).toBe(false);
    // A single bad payload fails the same way it always has.
    expect(decodeAttestationLink("#e30")).toEqual(decodeAttestationFragment("#e30"));
  });

  it("labels a round with the report's first line that isn't a heading", () => {
    const summary = (report: string) => roundSummary({ ...attestation, report });
    expect(summary(reports[0]!)).toBe("Area: Key material (tier 1).");
    expect(summary(reports[2]!)).toBe("Area: Trust boundary");
    expect(summary("# Only a heading\n\n")).toBe("claude-opus-5-5, pass");
    expect(summary("x".repeat(200))).toHaveLength(90);
  });

  it("links each round to the app on its own and adds up points", () => {
    expect(appAttestHref("abc")).toBe("https://open.gleamwallet.app/attest#abc");
    expect(sumPoints(["1000000000000", "2500000000000", "0", "<b>", undefined])).toBe("3500000000000");
    expect(sumPoints([])).toBe("0");
  });
});

describe("site scan lib: extension id", () => {
  const DEV_ID = "a".repeat(32);
  const memoryStorage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      values,
    };
  };
  const at = (url: string) => new URL(url);

  it("uses the store id on the live site, whatever the link or storage says", () => {
    const storage = memoryStorage({ [DEV_EXTENSION_KEY]: DEV_ID });
    expect(extensionIdFor(at(`https://gleamwallet.app/attest.html?ext=${DEV_ID}`), storage)).toBe(STORE_EXTENSION_ID);
    expect(extensionIdFor(at(`http://foo.localhost/attest.html?ext=${DEV_ID}`), storage)).toBe(STORE_EXTENSION_ID);
    expect(extensionIdFor(undefined, storage)).toBe(STORE_EXTENSION_ID);
  });

  it("on localhost takes ?ext= and remembers it for the other pages", () => {
    const storage = memoryStorage();
    expect(extensionIdFor(at(`http://localhost:8080/attest.html?ext=${DEV_ID}`), storage)).toBe(DEV_ID);
    expect(storage.values.get(DEV_EXTENSION_KEY)).toBe(DEV_ID);
    expect(extensionIdFor(at("http://127.0.0.1:8080/scan.html"), storage)).toBe(DEV_ID);
  });

  it("ignores an id that isn't an extension id", () => {
    const storage = memoryStorage({ [DEV_EXTENSION_KEY]: "not-an-id" });
    expect(extensionIdFor(at("http://localhost/attest.html?ext=ZZZ"), storage)).toBe(STORE_EXTENSION_ID);
    expect(storage.values.get(DEV_EXTENSION_KEY)).toBe("not-an-id");
  });
});

describe("site scan lib: sending to the extension", () => {
  const withRuntime = (respond: (cb: (reply?: unknown) => void, runtime: { lastError?: { message: string } }) => void) => {
    const runtime: { lastError?: { message: string }; sendMessage: ReturnType<typeof vi.fn> } = {
      sendMessage: vi.fn((_id: string, _message: unknown, cb: (reply?: unknown) => void) => respond(cb, runtime)),
    };
    return runtime;
  };

  it("sends only the type and the attestation to the extension id", async () => {
    const runtime = withRuntime((cb) => cb({ ok: true, attestationId: "f".repeat(64), points: "0", paid: false, paidPlacesLeft: 3 }));
    const outcome = await sendAttestation(runtime, attestation);
    expect(runtime.sendMessage).toHaveBeenCalledWith(EXTENSION_ID, { type: "gleam-points:attest", attestation }, expect.any(Function));
    expect(outcome.kind).toBe("reply");
  });

  it("treats a missing chrome.runtime as Gleam not installed", async () => {
    expect(await sendAttestation(undefined, attestation)).toEqual({ kind: "no-extension" });
    expect(await sendAttestation({}, attestation)).toEqual({ kind: "no-extension" });
  });

  it("tells not installed from an interrupted extension", async () => {
    const missing = withRuntime((cb, r) => {
      r.lastError = { message: "Could not establish connection. Receiving end does not exist." };
      cb();
    });
    expect(await sendAttestation(missing, attestation)).toEqual({ kind: "no-extension" });
    const closed = withRuntime((cb, r) => {
      r.lastError = { message: "The message port closed before a response was received." };
      cb();
    });
    expect(await sendAttestation(closed, attestation)).toEqual({ kind: "interrupted" });
    const empty = withRuntime((cb) => cb(undefined));
    expect(await sendAttestation(empty, attestation)).toEqual({ kind: "interrupted" });
  });

  it("survives sendMessage throwing", async () => {
    const throwing = { sendMessage: () => { throw new Error("nope"); } };
    expect(await sendAttestation(throwing, attestation)).toEqual({ kind: "no-extension" });
  });

  it("asks Gleam which step comes before signing", async () => {
    const ready = withRuntime((cb) => cb({ ok: true }));
    expect(await checkGleam(ready)).toBe("ready");
    expect(ready.sendMessage).toHaveBeenCalledWith(EXTENSION_ID, { type: "gleam-points:attest-status" }, expect.any(Function));
    for (const [code, state] of [
      ["no_wallet", "no-wallet"],
      ["unsupported_wallet", "unsupported"],
      ["wallet_not_registered", "not-joined"],
    ]) {
      expect(await checkGleam(withRuntime((cb) => cb({ ok: false, code })))).toBe(state);
    }
    expect(await checkGleam(undefined)).toBe("no-extension");
  });

  it("leaves the real check to Sign when the status reply can't be read", async () => {
    expect(await checkGleam(withRuntime((cb) => cb({ ok: false })))).toBe("ready");
    expect(await checkGleam(withRuntime((cb) => cb(undefined)))).toBe("ready");
  });

  it("leaves the real check to Sign when Gleam never answers", async () => {
    vi.useFakeTimers();
    try {
      const readiness = checkGleam(withRuntime(() => {}));
      await vi.advanceTimersByTimeAsync(4000);
      await expect(readiness).resolves.toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("site scan lib: outcomes", () => {
  const fail = (code: string, error = "A sentence from Gleam.") => describeOutcome({ kind: "reply", reply: { ok: false, code, error } });

  it("maps the named states", () => {
    expect(describeOutcome({ kind: "no-extension" })).toMatchObject({ state: "no-extension", action: "store" });
    expect(describeOutcome({ kind: "interrupted" })).toMatchObject({ state: "interrupted", action: "retry" });
    expect(fail("no_wallet")).toMatchObject({ state: "no-wallet", action: "wallet" });
    expect(fail("wallet_not_registered")).toMatchObject({ state: "no-wallet" });
    expect(fail("already_attested")).toMatchObject({ state: "already", action: "view" });
    expect(fail("release_not_latest")).toMatchObject({ state: "superseded", action: "agent" });
    expect(fail("busy")).toMatchObject({ state: "busy", action: "retry" });
  });

  it("shows the extension's own sentence, and a fallback when there is none", () => {
    expect(fail("offline", "Gleam couldn't reach the points server.").message).toBe("Gleam couldn't reach the points server.");
    expect(describeOutcome({ kind: "reply", reply: { ok: false, code: "offline" } }).message).toMatch(/Try again/);
  });

  it("gives every code in the protocol an action, and unknown codes a retry", () => {
    const codes = [
      "refused", "invalid_attestation", "no_wallet", "unsupported_wallet", "busy", "rejected", "timed_out", "signing_failed", "offline",
      "malformed_request", "message_mismatch", "invalid_signature", "wallet_not_registered", "wallet_not_live", "no_release",
      "unknown_release", "release_not_latest", "commit_mismatch", "challenge_unknown", "challenge_wrong_release",
      "challenge_wrong_commit", "challenge_expired", "challenge_used", "answers_failed", "already_attested", "rate_limited",
      "github_unavailable", "challenge_unavailable", "server_error",
    ];
    for (const code of codes) expect(["retry", "agent", "view", "wallet"], code).toContain(fail(code).action);
    expect(fail("something_new")).toMatchObject({ state: "retry", action: "retry" });
  });

  it("describes success, a full release and a release with no snapshot", () => {
    const id = "ab".repeat(32);
    const paid = describeOutcome({ kind: "reply", reply: { ok: true, attestationId: id, points: "1234500000000000", paid: true, paidPlacesLeft: 4 } });
    expect(paid).toMatchObject({ state: "success", action: "view", attestationId: id });
    expect(paid.message).toContain("1,234.5 points");
    expect(describeOutcome({ kind: "reply", reply: { ok: true, attestationId: id, points: "0", paid: false, unpaidReason: "places_taken", paidPlacesLeft: 0 } }).state).toBe("full");
    expect(describeOutcome({ kind: "reply", reply: { ok: true, attestationId: id, points: "0", paid: false, unpaidReason: "no_snapshot", paidPlacesLeft: 7 } }).state).toBe("unpaid");
    // Places left alone no longer implies "no snapshot yet".
    expect(describeOutcome({ kind: "reply", reply: { ok: true, attestationId: id, points: "0", paid: false, paidPlacesLeft: 7 } }).message).toBe("Your attestation is recorded. It earned no points.");
    expect(describeOutcome({ kind: "reply", reply: { ok: true, attestationId: "<b>", points: "0", paid: false, paidPlacesLeft: 7 } }).attestationId).toBeNull();
  });

  it("marks only the states with nothing left to sign as final", () => {
    const id = "ab".repeat(32);
    const final = (outcome: Parameters<typeof describeOutcome>[0]) => isFinal(describeOutcome(outcome));
    const reply = (r: object) => ({ kind: "reply" as const, reply: r });
    expect(final(reply({ ok: true, attestationId: id, points: "5", paid: true, paidPlacesLeft: 3 }))).toBe(true);
    expect(final(reply({ ok: true, attestationId: id, points: "0", paid: false, paidPlacesLeft: 0 }))).toBe(true);
    expect(final(reply({ ok: false, code: "already_attested", error: "x" }))).toBe(true);
    expect(final(reply({ ok: false, code: "release_not_latest", error: "x" }))).toBe(true);
    for (const code of ["busy", "rejected", "timed_out", "offline", "signing_failed", "no_wallet", "wallet_not_live", "something_new"]) {
      expect(final(reply({ ok: false, code, error: "x" })), code).toBe(false);
    }
    expect(final({ kind: "interrupted" })).toBe(false);
    expect(final({ kind: "no-extension" })).toBe(false);
  });

  it("formats atomic points", () => {
    expect(formatPoints("0")).toBe("0");
    expect(formatPoints("1000000000000")).toBe("1");
    expect(formatPoints("1999999999999")).toBe("1.99");
    expect(formatPoints("123456789000000000000")).toBe("123,456,789");
    expect(formatPoints("garbage")).toBe("0");
  });
});

describe("site scan lib: the points API", () => {
  const listing = {
    release: "1.4.0",
    commit: "a".repeat(40),
    paidPlacesLeft: 12,
    coverage: { examined: 41, total: 64, unexamined: [{ file: "a.ts", symbol: "f" }] },
    attestations: [],
    nextCursor: null,
  };
  const reply = (status: number, body: unknown) =>
    vi.fn<(url: string) => Promise<Response>>(async () => ({ ok: status < 400, status, json: async () => body }) as Response);

  it("requests the release and cursor", async () => {
    const fetchImpl = reply(200, listing);
    const result = await fetchListing(fetchImpl, { release: "1.4.0", cursor: "abc", limit: 50 });
    expect(result).toEqual({ ok: true, listing });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.gleamwallet.app/attestations?release=1.4.0&cursor=abc&limit=50");
  });

  it("reports errors without throwing", async () => {
    expect(await fetchListing(reply(404, { error: "No scans exist.", code: "unknown_release" }))).toEqual({ ok: false, status: 404, error: "No scans exist." });
    expect(await fetchListing(reply(200, { nope: true }))).toMatchObject({ ok: false });
    expect(await fetchListing(reply(503, null))).toMatchObject({ ok: false, status: 503 });
    expect(await fetchListing(vi.fn(async () => { throw new Error("offline"); }))).toMatchObject({ ok: false, status: 0 });
  });

  it("reads a release's review count", async () => {
    const count = { release: "1.4.0", total: 14, paidPlacesLeft: 86 };
    const fetchImpl = reply(200, count);
    expect(await fetchCount(fetchImpl, "1.4.0")).toEqual({ ok: true, count });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.gleamwallet.app/attestations/count?release=1.4.0");
    expect(await fetchCount(reply(200, { ...count, total: "14" }), "1.4.0")).toMatchObject({ ok: false });
  });

  it("reads the scan reward and bounty pool", async () => {
    const rewards = { day: "2026-10-19", issuedAtomic: "1000000000000000", scanRewardAtomic: "1000000000000", bountyPoolAtomic: "0" };
    const fetchImpl = reply(200, rewards);
    expect(await fetchRewards(fetchImpl)).toEqual({ ok: true, rewards });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.gleamwallet.app/scan/rewards");
    expect(await fetchRewards(reply(200, { ...rewards, day: null }))).toMatchObject({ ok: true });
    expect(await fetchRewards(reply(200, { ...rewards, scanRewardAtomic: 1.5 }))).toMatchObject({ ok: false });
    expect(await fetchRewards(reply(200, { ...rewards, bountyPoolAtomic: "-1" }))).toMatchObject({ ok: false });
    expect(await fetchRewards(reply(200, { ...rewards, scanRewardAtomic: undefined }))).toMatchObject({ ok: false });
    expect(await fetchRewards(vi.fn(async () => { throw new Error("offline"); }))).toMatchObject({ ok: false, status: 0 });
  });

  it("pays every paid place the same reward, and nothing once they're taken", () => {
    const rewards = { scanRewardAtomic: "1000" };
    expect(nextScanReward(rewards, 100)).toBe("1000");
    expect(nextScanReward(rewards, 1)).toBe("1000");
    expect(nextScanReward(rewards, 0)).toBe("0");
    expect([MIN_PAID_SCANS_PER_RELEASE, MIN_PAID_SCANS_PER_MINOR_RELEASE, PAID_SCANS_PER_RELEASE]).toEqual([
      CORE_MIN_PAID_SCANS_PER_RELEASE,
      CORE_MIN_PAID_SCANS_PER_MINOR_RELEASE,
      CORE_PAID_SCANS_PER_RELEASE,
    ]);
  });

  it("names the paid places a release opened when the server says", () => {
    expect(placesOf({ paidPlacesLeft: 7, paidScans: 3 })).toBe(" of 10");
    expect(placesOf({ paidPlacesLeft: 0, paidScans: 100 })).toBe(" of 100");
    expect(placesOf({ paidPlacesLeft: 7 })).toBe("");
  });

  it("works out each bounty tier from the pool, rounding down as the server pays", () => {
    expect(bountyTiers("1001").map((tier) => [tier.severity, tier.amountAtomic])).toEqual([
      ["Critical", "500"],
      ["High", "250"],
      ["Medium", "100"],
    ]);
    expect(bountyTiers("123456789012345678901234567890")[0]!.amountAtomic).toBe("61728394506172839450617283945");
    expect(bountyTiers(null).every((tier) => tier.amountAtomic === null)).toBe(true);
    expect(bountyTiers("1e9")[0]!.amountAtomic).toBeNull();
  });

  it("summarises coverage", () => {
    expect(coverageSummary(listing.coverage)).toEqual({
      share: 41 / 64,
      text: "41 of 64 security functions examined by at least one scan",
      unexamined: [{ file: "a.ts", symbol: "f" }],
      byArea: null,
    });
    expect(coverageSummary({ examined: 3, total: 4, unexamined: null })!.unexamined).toBeNull();
    const byArea = [{ id: "keys", label: "Key material", examined: 3, total: 4 }];
    expect(coverageSummary({ examined: 3, total: 4, unexamined: [], byArea })!.byArea).toEqual([
      { label: "Key material", examined: 3, total: 4, share: 0.75, scans: null },
    ]);
    expect(coverageSummary(null)).toBeNull();
    expect(coverageSummary({ examined: 0, total: 0, unexamined: [] })).toBeNull();
  });
});

describe("site scan lib: areas and rounds", () => {
  const reply = (status: number, body: unknown) =>
    vi.fn<(url: string) => Promise<Response>>(async () => ({ ok: status < 400, status, json: async () => body }) as Response);
  const areas = {
    release: "1.44.0",
    areas: [
      { id: "keys", label: "Key material", tier: 1, functions: 20, examined: 5, scans: 2 },
      { id: "build", label: "Build and release", tier: 5, functions: 0, examined: 0, scans: 0 },
    ],
  };

  it("matches core's areas and round step", () => {
    expect(SCAN_AREAS).toEqual(CORE_SCAN_AREAS);
    expect(ROUND_STEP_PERCENT).toBe(CORE_ROUND_STEP_PERCENT);
  });

  it("reads the round step from the rewards, falling back to the built-in one", () => {
    expect(roundStepPercent({ roundStepPercent: 15 })).toBe(15);
    expect(roundStepPercent({})).toBe(10);
    expect(roundStepPercent({ roundStepPercent: "10" })).toBe(10);
    expect(roundStepPercent(null)).toBe(10);
  });

  it("names an attestation's area and round", () => {
    expect(areaLabel("boundary")).toBe("Trust boundary");
    expect(areaLabel(null)).toBe("Whole surface");
    expect(areaLabel(undefined)).toBe("Whole surface");
    expect(areaLabel("<b>new</b>")).toBe("<b>new</b>");
    expect(roundLabel(2)).toBe("Round 2");
    expect(roundLabel(null)).toBeNull();
    expect(roundLabel(0)).toBeNull();
  });

  it("reads per-area coverage", async () => {
    const fetchImpl = reply(200, areas);
    expect(await fetchAreas(fetchImpl)).toEqual({ ok: true, areas });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.gleamwallet.app/scan/areas");
    expect(await fetchAreas(reply(200, { ...areas, areas: [{ ...areas.areas[0], scans: -1 }] }))).toMatchObject({ ok: false });
    expect(await fetchAreas(reply(200, { release: "1.44.0" }))).toMatchObject({ ok: false });
    expect(await fetchAreas(reply(404, { error: "Not found." }))).toEqual({ ok: false, status: 404, error: "Not found." });
  });

  it("shapes area rows from either source", () => {
    expect(areaRows(areas.areas)).toEqual([
      { label: "Key material", examined: 5, total: 20, share: 0.25, scans: 2 },
      { label: "Build and release", examined: 0, total: 0, share: 0, scans: 0 },
    ]);
    expect(areaRows([{ id: "keys", label: "Key material", examined: 9, total: 4 }])![0]!.share).toBe(1);
    expect(areaRows(null)).toBeNull();
    expect(areaRows([])).toBeNull();
    expect(areaRows([{ id: "keys", label: "Key material", examined: 1.5, total: 4 }])).toBeNull();
  });
});

describe("site scan lib: small helpers", () => {
  it("links a release's results, optionally at one scan", () => {
    expect(resultsHref("1.4.0")).toBe("review-results.html?v=1.4.0");
    expect(resultsHref("1.4.0", "ab".repeat(32))).toBe(`review-results.html?v=1.4.0#${"ab".repeat(32)}`);
    expect(resultsHref("1.4.0\"><x", "nope")).toBe("review-results.html");
    expect(resultsHref(null)).toBe("review-results.html");
  });

  it("reads the release and entry id from the URL", () => {
    expect(releaseFromSearch("?v=1.4.0")).toBe("1.4.0");
    expect(releaseFromSearch("?v=v1.4.0")).toBeNull();
    expect(releaseFromSearch("?v=1.4.0%3Cscript%3E")).toBeNull();
    expect(releaseFromSearch("")).toBeNull();
    expect(idFromHash(`#${"ab".repeat(32)}`)).toBe("ab".repeat(32));
    expect(idFromHash("#nope")).toBeNull();
  });

  it("lists the models no label belongs to", () => {
    expect(unusedModels([])).toContain("Gemini 3");
    const used = unusedModels(["claude-opus-5-5", "GPT-5", "Gemini 3 Pro"]);
    expect(used).not.toContain("Claude");
    expect(used).not.toContain("GPT");
    expect(used).not.toContain("Gemini 3");
    expect(used).toContain("DeepSeek V4");
  });

  it("keeps the prompt as SCANS.md has it", () => {
    expect(AGENT_LINE).toBe(
      "Scan the latest Gleam release for security issues by following security/scan/SKILL.md in https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet. The skill clones the repo, installs its pnpm dependencies (which add a lefthook git hook to the checkout), runs its tests and osv-scanner, and calls the Gleam Points API at api.gleamwallet.app. It never needs a seed phrase, a real key, a wallet or funds. Ask me before filing an advisory.",
    );
  });
});
