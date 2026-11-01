/* global atob, TextDecoder */
// Logic shared by scan.html, review-results.html and attest.html, kept free of the DOM so Vitest can
// run it (scripts/site-scan.site.test.ts). Everything that comes from the
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
  "Scan the latest Gleam release for security issues by following security/scan/SKILL.md in https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet. The skill clones the repo, installs its pnpm dependencies (which add a lefthook git hook to the checkout), runs its tests and osv-scanner, and calls the Gleam Points API at api.gleamwallet.app. It never needs a seed phrase, a real key, a wallet or funds. Ask me before any gh action: forking, pushing, opening a PR or filing an advisory.";

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

const BAD_LINK = "This link isn't a Gleam attestation. Open the link `pnpm scan finish` printed, unchanged.";

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
  already: "This wallet already attested this release. Each wallet attests a release once.",
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
      message = `Your attestation is recorded, but this release's ${PAID_SCANS_PER_RELEASE} paid places are taken, so it earns no points.`;
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
    ATOMIC.test(body.tailScanRewardAtomic) &&
    ATOMIC.test(body.bountyPoolAtomic)
  );
}

/** Paid scans per release and how many of them earn the full reward; the same as `@gleam/core/scan`. */
export const PAID_SCANS_PER_RELEASE = 100;
export const FULL_REWARD_SCANS = 20;

/** What the next scan of a release with `paidPlacesLeft` open places earns, from a `GET /scan/rewards` body. */
export function nextScanReward(rewards, paidPlacesLeft) {
  if (paidPlacesLeft <= 0) return "0";
  return paidPlacesLeft > PAID_SCANS_PER_RELEASE - FULL_REWARD_SCANS ? rewards.scanRewardAtomic : rewards.tailScanRewardAtomic;
}

/**
 * Reads `GET /scan/rewards`: what a paid scan earns now (full and tail) and the bounty pool's
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
  { severity: "Low", percent: 2 },
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

/** "41 of 64 security functions examined by at least one review", or null before the server has a figure. */
export function coverageSummary(coverage) {
  if (!coverage || !Number.isInteger(coverage.examined) || !Number.isInteger(coverage.total) || coverage.total <= 0) return null;
  const share = Math.min(1, Math.max(0, coverage.examined / coverage.total));
  return {
    share,
    text: `${coverage.examined} of ${coverage.total} security functions examined by at least one review`,
    unexamined: Array.isArray(coverage.unexamined) ? coverage.unexamined : null,
  };
}
