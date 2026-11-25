/* global atob, TextDecoder */
// Logic shared by scan.html, review-results.html and attest.html. Nothing
// touches the DOM at import time (`$`, `el` and `renderAreaRows` do only when
// called), so Vitest can run it (scripts/site-scan.site.test.ts). Everything that comes from the
// network or the link is data: callers render it with textContent only.

export const STORE_EXTENSION_ID = "einabcphdmlicabnjllaaallnebfkmki";
export const STORE_URL = "https://chromewebstore.google.com/detail/gleam/" + STORE_EXTENSION_ID;
export const DEV_EXTENSION_KEY = "gleam:devExtensionId";
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/**
 * The extension to message. A copy of the site served from localhost can
 * name an unpacked dev build's id with `?ext=<id>`, remembered in
 * localStorage for the other pages; anywhere else it's the store id.
 * Keep in step with `devExtensionId` in pages.js.
 */
export function extensionIdFor(loc, storage) {
  if (!loc || (loc.hostname !== "localhost" && loc.hostname !== "127.0.0.1")) return STORE_EXTENSION_ID;
  try {
    const fromQuery = new URLSearchParams(loc.search).get("ext");
    if (fromQuery && EXTENSION_ID_PATTERN.test(fromQuery)) {
      storage?.setItem(DEV_EXTENSION_KEY, fromQuery);
      return fromQuery;
    }
    const saved = storage?.getItem(DEV_EXTENSION_KEY);
    if (saved && EXTENSION_ID_PATTERN.test(saved)) return saved;
  } catch {
    // Storage blocked: fall back to the store id.
  }
  return STORE_EXTENSION_ID;
}

function pageStorage() {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const EXTENSION_ID = extensionIdFor(typeof location === "undefined" ? undefined : location, pageStorage());
export const POINTS_API = "https://api.gleamwallet.app";
export const ATTEST_MESSAGE_TYPE = "gleam-points:attest";
export const ATTEST_STATUS_MESSAGE_TYPE = "gleam-points:attest-status";

// SCANS.md § How it works, step 1.
export const AGENT_LINE =
  "Scan the latest Gleam release for security issues by following security/scan/SKILL.md in https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet. The skill clones the repo, installs its pnpm dependencies (which add a lefthook git hook to the checkout), runs its tests and osv-scanner, and calls the Gleam Points API at api.gleamwallet.app. It never needs a seed phrase, a real key, a wallet or funds. Ask me before filing an advisory.";

export const RELEASE_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const ID_PATTERN = /^[0-9a-f]{64}$/;

// A short list of model families. A family counts as used when any release
// label contains one of its `match` strings, ignoring case and punctuation.
export const KNOWN_MODELS = [
  { name: "Claude", match: ["claude"] },
  { name: "GPT", match: ["gpt", "codex"] },
  { name: "Gemini 3", match: ["gemini"] },
  { name: "DeepSeek V4", match: ["deepseek"] },
  { name: "Qwen 3", match: ["qwen"] },
  { name: "Kimi", match: ["kimi"] },
  { name: "GLM", match: ["glm"] },
  { name: "Grok", match: ["grok"] },
  { name: "Mistral", match: ["mistral", "codestral"] },
];

function squash(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Names from the short list that none of the labels belong to. */
export function unusedModels(labels) {
  const used = labels.map(squash);
  return KNOWN_MODELS.filter((model) => !model.match.some((needle) => used.some((label) => label.includes(needle)))).map(
    (model) => model.name,
  );
}

/** The release to show: `?v=` when it is a plain x.y.z, else null (the latest). */
export function releaseFromSearch(search) {
  const value = new URLSearchParams(search).get("v");
  return value !== null && RELEASE_PATTERN.test(value) ? value : null;
}

/** An attestation id from a link's fragment, or null. */
export function idFromHash(hash) {
  const value = hash.replace(/^#/, "");
  return ID_PATTERN.test(value) ? value : null;
}

// --- attest.html: the link's payload ---------------------------------------

const BAD_LINK = "This link isn't a Gleam attestation. Open the link your agent printed, unchanged.";
const TOO_MANY_ROUNDS = "This link has more rounds than a release has areas. Open the link your agent printed, unchanged.";
const DAMAGED_ROUND = "This round's part of the link is damaged, so it can't be signed.";

/**
 * Decodes `attest.html#<payload>`: base64url (no padding) of UTF-8 JSON, the
 * same steps as `decodeAttestationPayload` in packages/core/src/scan/payload.ts.
 * The extension runs its own full check before anything is signed, so this
 * only verifies what the page needs to show a summary.
 */
export function decodeAttestationFragment(hash) {
  const payload = hash.replace(/^#/, "");
  let value;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("not base64url");
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, error: BAD_LINK };
  }
  if (!isShowable(value)) return { ok: false, error: BAD_LINK };
  return { ok: true, attestation: value };
}

/**
 * Decodes `attest.html#<p1>.<p2>…`, one payload per round (`.` is outside the
 * base64url alphabet). A payload that doesn't decode is a damaged round, so
 * the rest can still be signed; the link fails as a whole only when it is
 * empty, malformed, carries more rounds than a release has areas, or has no
 * round that decodes. Settles with `{ ok: true, rounds }`, each round
 * `{ ok: true, payload, attestation }` or `{ ok: false, payload, error }`, or
 * with `{ ok: false, error }`.
 */
export function decodeAttestationLink(hash) {
  const parts = hash.replace(/^#/, "").split(".");
  if (parts.length > SCAN_AREAS.length) return { ok: false, error: TOO_MANY_ROUNDS };
  if (parts.some((part) => part === "")) return { ok: false, error: BAD_LINK };
  const rounds = parts.map((payload) => {
    const decoded = decodeAttestationFragment(payload);
    return decoded.ok ? { ok: true, payload, attestation: decoded.attestation } : { ok: false, payload, error: DAMAGED_ROUND };
  });
  if (!rounds.some((round) => round.ok)) return { ok: false, error: BAD_LINK };
  return { ok: true, rounds };
}

/** The app's attest link for one payload: the app takes one attestation per link. */
export function appAttestHref(payload) {
  return `https://open.gleamwallet.app/attest#${payload}`;
}

const SUMMARY_MAX = 90;

/**
 * A one-line label for a round: the report's first line that isn't a heading
 * (its "Area: …" line, as the skill writes it), without list or emphasis
 * marks; the model and result when the report has no such line.
 */
export function roundSummary(attestation) {
  for (const raw of attestation.report.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const line = trimmed.replace(/^(?:[-*+]|\d+\.)\s+/, "").replace(/\*\*|`/g, "").trim();
    if (line === "") continue;
    return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}\u2026` : line;
  }
  return `${attestation.model}, ${attestation.result}`;
}

/** The sum of atomic point amounts; anything that isn't one counts as 0. */
export function sumPoints(amounts) {
  let total = 0n;
  for (const amount of amounts) if (typeof amount === "string" && /^\d{1,40}$/.test(amount)) total += BigInt(amount);
  return total.toString();
}

function isShowable(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.release !== "string" || !RELEASE_PATTERN.test(value.release)) return false;
  for (const key of ["commit", "model", "challenge", "report"]) if (typeof value[key] !== "string") return false;
  if (value.result !== "pass" && value.result !== "scanned") return false;
  if (!Array.isArray(value.answers)) return false;
  return value.answers.every(
    (a) =>
      a !== null &&
      typeof a === "object" &&
      typeof a.file === "string" &&
      typeof a.symbol === "string" &&
      typeof a.check === "string" &&
      Number.isInteger(a.line),
  );
}

// --- attest.html: talking to the extension ---------------------------------

/**
 * Sends `message` to Gleam and settles with one of:
 * `{ kind: "no-extension" }`: Gleam isn't installed (or can't be reached from here);
 * `{ kind: "interrupted" }`: the extension went away mid-request (its service
 *   worker restarted, the port closed), so trying again is the right step;
 * `{ kind: "reply", reply }`: an object with a boolean `ok`.
 * It never rejects.
 */
function sendToGleam(runtime, message) {
  return new Promise((resolve) => {
    if (!runtime || typeof runtime.sendMessage !== "function") {
      resolve({ kind: "no-extension" });
      return;
    }
    try {
      runtime.sendMessage(EXTENSION_ID, message, (reply) => {
        const lastError = runtime.lastError;
        if (lastError) {
          const text = String((lastError && lastError.message) || "");
          // Chrome's wording when nothing is listening: not installed, disabled, or the wrong id.
          resolve(
            /receiving end does not exist|extension not found|invalid extension id|could not establish connection/i.test(text)
              ? { kind: "no-extension" }
              : { kind: "interrupted" },
          );
          return;
        }
        if (reply === null || typeof reply !== "object" || typeof reply.ok !== "boolean") {
          resolve({ kind: "interrupted" });
          return;
        }
        resolve({ kind: "reply", reply });
      });
    } catch {
      resolve({ kind: "no-extension" });
    }
  });
}

/** Sends the attestation to Gleam; the reply is a `SiteAttestResponse`. Settles as `sendToGleam` does. */
export function sendAttestation(runtime, attestation) {
  return sendToGleam(runtime, { type: ATTEST_MESSAGE_TYPE, attestation });
}

const READINESS_BY_CODE = { no_wallet: "no-wallet", unsupported_wallet: "unsupported", wallet_not_registered: "not-joined" };
const CHECK_TIMEOUT_MS = 4000;

/**
 * What the Sign button should offer before anyone clicks it: "no-extension",
 * "no-wallet", "unsupported", "not-joined" or "ready". Anything the check
 * can't read counts as "ready", so Sign runs the real check and says what's wrong.
 * That includes no answer in time: only this check is limited, since a real
 * signature waits for as long as the user keeps Gleam's window open.
 */
export async function checkGleam(runtime) {
  const timedOut = new Promise((resolve) => setTimeout(() => resolve({ kind: "interrupted" }), CHECK_TIMEOUT_MS));
  const outcome = await Promise.race([sendToGleam(runtime, { type: ATTEST_STATUS_MESSAGE_TYPE }), timedOut]);
  if (outcome.kind === "no-extension") return "no-extension";
  if (outcome.kind === "reply" && !outcome.reply.ok) return READINESS_BY_CODE[outcome.reply.code] || "ready";
  return "ready";
}

// What each state shows. `action` is the one next step the page offers:
// "retry" shows the Sign button again, "store" the install link, "agent" a
// way back to the instructions for a new scan, "view" the entry on review-results.html,
// "wallet" nothing to click (the sentence says where to go in Gleam).
const FALLBACK = {
  success: "Your attestation is recorded.",
  "no-extension": "Gleam isn't installed in this browser, so it can't sign this attestation.",
  interrupted: "Gleam stopped answering before it finished. Your attestation was not recorded as far as this page can tell, so try again.",
  "no-wallet": "Gleam has no wallet registered for points. Create one in Gleam, join Gleam Points, then come back to this link.",
  already: "This wallet already scanned this area of the release. Each wallet scans an area once per release.",
  superseded: "A newer release is out, so this scan can't be signed. Ask your agent to scan the latest release.",
  expired: "This scan can't be signed any more. Ask your agent to start a new one.",
  busy: "Gleam is already showing an attestation to sign. Finish or close that window, then try again.",
  retry: "The attestation wasn't recorded. Try again.",
};

const BY_CODE = {
  no_wallet: ["no-wallet", "wallet"],
  wallet_not_registered: ["no-wallet", "wallet"],
  already_attested: ["already", "view"],
  release_not_latest: ["superseded", "agent"],
  busy: ["busy", "retry"],
  // The link or its challenge is no good: signing it again can't help.
  invalid_attestation: ["expired", "agent"],
  malformed_request: ["expired", "agent"],
  commit_mismatch: ["expired", "agent"],
  challenge_unknown: ["expired", "agent"],
  challenge_wrong_release: ["expired", "agent"],
  challenge_wrong_commit: ["expired", "agent"],
  challenge_expired: ["expired", "agent"],
  challenge_used: ["expired", "agent"],
  answers_failed: ["expired", "agent"],
  unknown_release: ["expired", "agent"],
  // Everything else is worth another go once the cause (named in `error`) is dealt with.
  refused: ["retry", "retry"],
  unsupported_wallet: ["retry", "retry"],
  rejected: ["retry", "retry"],
  timed_out: ["retry", "retry"],
  signing_failed: ["retry", "retry"],
  offline: ["retry", "retry"],
  message_mismatch: ["retry", "retry"],
  invalid_signature: ["retry", "retry"],
  wallet_not_live: ["retry", "retry"],
  no_release: ["retry", "retry"],
  rate_limited: ["retry", "retry"],
  github_unavailable: ["retry", "retry"],
  challenge_unavailable: ["retry", "retry"],
  server_error: ["retry", "retry"],
};

/**
 * Turns the result of `sendAttestation` into what the page shows:
 * `{ state, message, action, points?, paid?, attestationId? }`. `message` is
 * the extension's own sentence when it sent one, so the page and Gleam's
 * window say the same thing. Unknown codes fall back to "retry".
 */
export function describeOutcome(outcome) {
  if (outcome.kind === "no-extension") return { state: "no-extension", message: FALLBACK["no-extension"], action: "store" };
  if (outcome.kind === "interrupted") return { state: "interrupted", message: FALLBACK.interrupted, action: "retry" };
  const reply = outcome.reply;
  if (reply.ok) {
    const id = typeof reply.attestationId === "string" && ID_PATTERN.test(reply.attestationId) ? reply.attestationId : null;
    const paid = reply.paid === true;
    let state = "success";
    let message = "Your attestation is signed and recorded.";
    if (paid) {
      message = `Your attestation is signed and recorded. You earned ${formatPoints(reply.points)} points.`;
    } else if (reply.unpaidReason === "places_taken") {
      state = "full";
      message = "Your attestation is recorded, but this release's paid places are taken, so it earns no points.";
    } else if (reply.unpaidReason === "no_snapshot") {
      state = "unpaid";
      message = "Your attestation is recorded. It earned no points yet, because no daily points count exists to base them on.";
    } else {
      state = "unpaid";
      message = "Your attestation is recorded. It earned no points.";
    }
    return { state, message, action: "view", paid, points: paid ? reply.points : "0", attestationId: id };
  }
  const code = typeof reply.code === "string" ? reply.code : "";
  const [state, action] = BY_CODE[code] || ["retry", "retry"];
  const text = typeof reply.error === "string" && reply.error.trim() !== "" ? reply.error.trim() : FALLBACK[state];
  return { state, message: text, action };
}

/** Final states have nothing left to sign: the page shows the state's own next step and no Sign button. */
export function isFinal(outcome) {
  return outcome.action === "view" || outcome.action === "agent";
}

/** Atomic points (12 decimals) as "1,234.5": two decimals at most, never rounded up. */
export function formatPoints(atomic) {
  if (typeof atomic !== "string" || !/^\d{1,30}$/.test(atomic)) return "0";
  const padded = atomic.padStart(13, "0");
  const whole = padded.slice(0, -12).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-12, -10).replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

// --- DOM helpers for the three pages ---------------------------------------

export const $ = (selector) => document.querySelector(selector);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Fills an area coverage table's body from `areaRows`; `withScans` adds each area's scan count. */
export function renderAreaRows(tbody, rows, withScans) {
  tbody.textContent = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    const label = el("th", "", row.label);
    label.scope = "row";
    tr.appendChild(label);
    const examined = el("td", "areas-examined");
    examined.appendChild(el("span", "", `${row.examined} of ${row.total}`));
    const bar = el("span", "areas-bar");
    bar.setAttribute("aria-hidden", "true");
    const fill = el("span");
    fill.style.width = `${(row.share * 100).toFixed(1)}%`;
    bar.appendChild(fill);
    examined.appendChild(bar);
    tr.appendChild(examined);
    if (withScans) tr.appendChild(el("td", "num", String(row.scans)));
    tbody.appendChild(tr);
  }
}

// --- scan.html and review-results.html: the points API -----------------------

/** GETs `path` from the points API. Settles with `{ ok: true, body }` or `{ ok: false, status, error }`; it never rejects. */
async function getJson(fetchImpl, path, signal, isValid) {
  try {
    const response = await fetchImpl(`${POINTS_API}${path}`, { signal });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = body && typeof body.error === "string" ? body.error : `The points server answered ${response.status}.`;
      return { ok: false, status: response.status, error };
    }
    if (!isValid(body)) return { ok: false, status: response.status, error: "The points server sent something this page can't read." };
    return { ok: true, body };
  } catch {
    return { ok: false, status: 0, error: "The points server couldn't be reached." };
  }
}

/**
 * Reads one page of `GET /attestations`. Settles with `{ ok: true, listing }`
 * or `{ ok: false, status, error }`; it never rejects.
 * @param {(url: string, init?: RequestInit) => Promise<Response>} fetchImpl
 * @param {{ release?: string | null, cursor?: string | null, limit?: number, signal?: AbortSignal }} [options]
 */
export async function fetchListing(fetchImpl, { release = null, cursor = null, limit = 100, signal } = {}) {
  const params = new URLSearchParams();
  if (release) params.set("release", release);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  const result = await getJson(fetchImpl, `/attestations?${params}`, signal, isListing);
  return result.ok ? { ok: true, listing: result.body } : result;
}

const ATOMIC = /^\d{1,40}$/;

function isRewards(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    (body.day === null || typeof body.day === "string") &&
    ATOMIC.test(body.issuedAtomic) &&
    ATOMIC.test(body.scanRewardAtomic) &&
    ATOMIC.test(body.bountyPoolAtomic)
  );
}

/** The paid places a release opens, at least and at most; the same as `@gleam/core/scan`. */
export const MIN_PAID_SCANS_PER_RELEASE = 1;
export const MIN_PAID_SCANS_PER_MINOR_RELEASE = 50;
export const PAID_SCANS_PER_RELEASE = 100;

/** What the next scan earns, from a `GET /scan/rewards` body and a release's `paidPlacesLeft`. */
export function nextScanReward(rewards, paidPlacesLeft) {
  return paidPlacesLeft > 0 ? rewards.scanRewardAtomic : "0";
}

/** " of N", the paid places a listing's release opened; empty when the server doesn't say. */
export function placesOf(listing) {
  return Number.isInteger(listing.paidScans) ? ` of ${listing.paidScans + Math.max(0, listing.paidPlacesLeft)}` : "";
}

/**
 * Reads `GET /scan/rewards`: what a paid scan earns now and the bounty pool's
 * balance. Settles with `{ ok: true, rewards }` or `{ ok: false, … }`.
 */
export async function fetchRewards(fetchImpl, { signal } = {}) {
  const result = await getJson(fetchImpl, "/scan/rewards", signal, isRewards);
  return result.ok ? { ok: true, rewards: result.body } : result;
}

// SCANS.md § Findings: the share of the pool's balance an accepted finding takes.
export const BOUNTY_TIERS = [
  { severity: "Critical", percent: 50 },
  { severity: "High", percent: 25 },
  { severity: "Medium", percent: 10 },
];

/** Each tier with what it would pay from a pool of `poolAtomic` today, in atomic units (integer division, as the server pays). */
export function bountyTiers(poolAtomic) {
  const pool = typeof poolAtomic === "string" && ATOMIC.test(poolAtomic) ? BigInt(poolAtomic) : null;
  return BOUNTY_TIERS.map((tier) => ({
    ...tier,
    amountAtomic: pool === null ? null : ((pool * BigInt(tier.percent)) / 100n).toString(),
  }));
}

function isCount(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof body.release === "string" &&
    Number.isInteger(body.total) &&
    Number.isInteger(body.paidPlacesLeft)
  );
}

/**
 * Reads `GET /attestations/count`: how many reviews `release` has. Settles with
 * `{ ok: true, count }` or `{ ok: false, … }`.
 */
export async function fetchCount(fetchImpl, release, { signal } = {}) {
  const params = new URLSearchParams({ release });
  const result = await getJson(fetchImpl, `/attestations/count?${params}`, signal, isCount);
  return result.ok ? { ok: true, count: result.body } : result;
}

/** The results page for a release, optionally opened at one attestation. */
export function resultsHref(release, attestationId) {
  const base = release && RELEASE_PATTERN.test(release) ? `review-results.html?v=${release}` : "review-results.html";
  return attestationId && ID_PATTERN.test(attestationId) ? `${base}#${attestationId}` : base;
}

function isListing(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof body.release === "string" &&
    Number.isInteger(body.paidPlacesLeft) &&
    Array.isArray(body.attestations)
  );
}

// --- Areas and rounds --------------------------------------------------------

/** The areas a release is scanned in, one per surface tier; the same as `SCAN_AREAS` in `@gleam/core/scan`. */
export const SCAN_AREAS = [
  { id: "keys", tier: 1, label: "Key material" },
  { id: "signing", tier: 2, label: "Signing" },
  { id: "boundary", tier: 3, label: "Trust boundary" },
  { id: "preview", tier: 4, label: "Approval preview" },
  { id: "build", tier: 5, label: "Build and release" },
];

/** How much more each further round of a release earns, in percent of round 1; the same as `@gleam/core/scan`. */
export const ROUND_STEP_PERCENT = 10;

/** The step a `GET /scan/rewards` body names, or the built-in one when it names none. */
export function roundStepPercent(rewards) {
  const step = rewards && rewards.roundStepPercent;
  return Number.isInteger(step) && step >= 0 && step <= 1000 ? step : ROUND_STEP_PERCENT;
}

/** An attestation's area as a label. Null is a scan from before areas, which covered the whole surface. */
export function areaLabel(id) {
  if (id === null || id === undefined) return "Whole surface";
  const known = SCAN_AREAS.find((area) => area.id === id);
  return known ? known.label : String(id);
}

/** "Round 2", or null for a scan from before rounds. */
export function roundLabel(round) {
  return Number.isInteger(round) && round > 0 ? `Round ${round}` : null;
}

const COUNT = (value) => Number.isInteger(value) && value >= 0;

function isAreaRow(row) {
  return row !== null && typeof row === "object" && typeof row.id === "string" && typeof row.label === "string";
}

function isAreas(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof body.release === "string" &&
    Array.isArray(body.areas) &&
    body.areas.every((row) => isAreaRow(row) && COUNT(row.functions) && COUNT(row.examined) && COUNT(row.scans))
  );
}

/**
 * Reads `GET /scan/areas`: how much of each area of the latest release has been
 * examined. Settles with `{ ok: true, areas }` or `{ ok: false, … }`.
 */
export async function fetchAreas(fetchImpl, { signal } = {}) {
  const result = await getJson(fetchImpl, "/scan/areas", signal, isAreas);
  return result.ok ? { ok: true, areas: result.body } : result;
}

/**
 * The rows of an area coverage table: `{ label, examined, total, share, scans }`,
 * `scans` null when the source doesn't count them. Takes `/scan/areas` rows
 * (`functions`) or a listing's `coverage.byArea` (`total`); null when there's nothing to show.
 */
export function areaRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = [];
  for (const row of rows) {
    if (!isAreaRow(row)) return null;
    const total = row.functions !== undefined ? row.functions : row.total;
    if (!COUNT(total) || !COUNT(row.examined)) return null;
    out.push({
      label: row.label,
      examined: row.examined,
      total,
      share: total > 0 ? Math.min(1, row.examined / total) : 0,
      scans: COUNT(row.scans) ? row.scans : null,
    });
  }
  return out;
}

/** "41 of 64 security functions examined by at least one scan", or null before the server has a figure. */
export function coverageSummary(coverage) {
  if (!coverage || !Number.isInteger(coverage.examined) || !Number.isInteger(coverage.total) || coverage.total <= 0) return null;
  const share = Math.min(1, Math.max(0, coverage.examined / coverage.total));
  return {
    share,
    text: `${coverage.examined} of ${coverage.total} security functions examined by at least one scan`,
    unexamined: Array.isArray(coverage.unexamined) ? coverage.unexamined : null,
    byArea: areaRows(coverage.byArea),
  };
}
