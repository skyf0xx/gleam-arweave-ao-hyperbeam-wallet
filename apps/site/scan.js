/* global AbortController */
// scan.html. Everything from the points API is untrusted text: nodes are
// built with textContent, never markup.
import {
  AGENT_LINE,
  bountyTiers,
  coverageSummary,
  fetchCount,
  fetchListing,
  fetchRewards,
  formatPoints,
  nextScanReward,
  resultsHref,
} from "./scan-lib.js";

const $ = (selector) => document.querySelector(selector);
const TIMEOUT_MS = 8000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// --- The line to paste ------------------------------------------------------

function setUpCopy() {
  const line = $("[data-agent-line]");
  const button = $("[data-copy]");
  const status = $("[data-copy-status]");
  line.textContent = AGENT_LINE;
  const scroll = $("[data-agent-scroll]");
  const markEnd = () => {
    scroll.toggleAttribute("data-end", line.scrollTop + line.clientHeight >= line.scrollHeight - 2);
  };
  line.addEventListener("scroll", markEnd, { passive: true });
  window.addEventListener("resize", markEnd);
  markEnd();
  let timer = 0;
  const done = (ok) => {
    status.textContent = ok ? "Copied. Now paste it into your agent." : "Select the line above and copy it.";
    button.textContent = ok ? "Copied" : "Copy prompt";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      status.textContent = "";
      button.textContent = "Copy prompt";
    }, 4000);
  };
  const fallback = () => {
    const range = document.createRange();
    range.selectNodeContents(line);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    done(ok);
  };
  button.addEventListener("click", () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(AGENT_LINE).then(() => done(true), fallback);
    } else {
      fallback();
    }
  });
}

// --- Live figures -----------------------------------------------------------

async function withTimeout(load) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const result = await load(controller.signal);
  window.clearTimeout(timer);
  return result;
}

// The severity rows are static so the shares read without the server; a known pool adds what each pays today.
function renderTiers(poolAtomic) {
  const rows = document.querySelectorAll("[data-tiers] tr");
  const tiers = bountyTiers(poolAtomic);
  const head = $(".tiers thead tr");
  if (tiers[0].amountAtomic !== null && !head.querySelector("[data-tier-amount]")) {
    const th = el("th", "num", "Today");
    th.scope = "col";
    th.dataset.tierAmount = "";
    head.appendChild(th);
  }
  tiers.forEach((tier, index) => {
    const row = rows[index];
    if (!row || tier.amountAtomic === null) return;
    row.querySelector("[data-tier-amount]")?.remove();
    const cell = el("td", "num tiers-amount", `${gleam(tier.amountAtomic)} GLEAM`);
    cell.dataset.tierAmount = "";
    row.appendChild(cell);
  });
}

// formatPoints stops at two decimals, so a tiny but real amount would read as nothing.
function gleam(atomic) {
  const text = formatPoints(atomic);
  return text === "0" && /^0*[1-9]\d*$/.test(atomic) ? "<0.01" : text;
}

/** Which reward the next review gets depends on the release's places left, so it needs both responses. */
function renderReviewFigures(rewards, listing) {
  $("[data-stat-places]").textContent = String(Math.max(0, listing.paidPlacesLeft));
  const reward = $("[data-stat-reward]");
  // Before the first daily snapshot a review is recorded unpaid, so "0" would mislead.
  if (rewards.day === null) {
    reward.textContent = "After the first snapshot";
    reward.parentElement.classList.add("figures-pending");
  } else {
    reward.textContent = gleam(nextScanReward(rewards, listing.paidPlacesLeft));
    reward.parentElement.classList.remove("figures-pending");
  }
  reveal($("[data-review-figures]"));
}

function reveal(figures) {
  figures.hidden = false;
  figures.classList.add("sweep");
}

function renderPool(rewards) {
  const pool = gleam(rewards.bountyPoolAtomic);
  document.querySelectorAll("[data-stat-pool]").forEach((node) => (node.textContent = pool));
  document.querySelectorAll("[data-pool-figures]").forEach(reveal);
  renderTiers(rewards.bountyPoolAtomic);
}

// The record is what anyone can check on the results page, so it shows only when every figure arrived.
function renderRecord(listing, count) {
  const coverage = coverageSummary(listing.coverage);
  const models = Array.isArray(listing.models) ? listing.models.length : null;
  if (!coverage || models === null) return;
  $("[data-record-release]").textContent = `v${listing.release}`;
  $("[data-record-reviews]").textContent = String(count.total);
  $("[data-record-coverage]").textContent = `${listing.coverage.examined} of ${listing.coverage.total}`;
  $("[data-record-models]").textContent = String(models);
  $("[data-record]").hidden = false;
}

async function loadFigures() {
  // One attestation is enough: the listing's paid places, coverage and models cover the whole release.
  const [rewards, listing] = await Promise.all([
    withTimeout((signal) => fetchRewards(window.fetch.bind(window), { signal })),
    withTimeout((signal) => fetchListing(window.fetch.bind(window), { limit: 1, signal })),
  ]);
  if (rewards.ok) renderPool(rewards.rewards);
  if (!listing.ok) return;

  const href = resultsHref(listing.listing.release);
  for (const link of document.querySelectorAll("[data-results-link]")) link.href = href;
  if (rewards.ok) renderReviewFigures(rewards.rewards, listing.listing);

  const count = await withTimeout((signal) => fetchCount(window.fetch.bind(window), listing.listing.release, { signal }));
  if (count.ok) renderRecord(listing.listing, count.count);
}

setUpCopy();
loadFigures();
