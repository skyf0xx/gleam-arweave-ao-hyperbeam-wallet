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
export const ID_PATTERN = /^[0-9a-f]{64}$/;

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

export const COUNT = (value) => Number.isInteger(value) && value >= 0;

export function isAreaRow(row) {
  return row !== null && typeof row === "object" && typeof row.id === "string" && typeof row.label === "string";
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
