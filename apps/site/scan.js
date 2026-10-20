/* global AbortController */
// scan.html. Everything from the points API is untrusted text: nodes are
// built with textContent, never markup.
import { AGENT_LINE, bountyTiers, fetchListing, fetchRewards, formatPoints, nextScanReward, resultsHref } from "./scan-lib.js";

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
  bountyTiers(poolAtomic).forEach((tier, index) => {
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

function renderRewards(rewards) {
  $("[data-stat-pool]").textContent = gleam(rewards.bountyPoolAtomic);
  renderTiers(rewards.bountyPoolAtomic);
}

/** Which reward the next scan gets depends on the release's places left, so it needs both responses. */
function renderNextReward(rewards, listing) {
  // Before the first daily snapshot a scan is recorded unpaid, so "0" would mislead.
  const reward = $("[data-stat-reward]");
  if (rewards.day === null) {
    reward.textContent = "After the first snapshot";
    reward.parentElement.classList.add("stats-pending");
  } else {
    reward.textContent = gleam(nextScanReward(rewards, listing.paidPlacesLeft));
    reward.parentElement.classList.remove("stats-pending");
  }
}

function renderListing(listing) {
  $("[data-stat-places]").textContent = String(Math.max(0, listing.paidPlacesLeft));
  const href = resultsHref(listing.release);
  for (const link of document.querySelectorAll("[data-results-link], .sc-header-link")) link.href = href;
}

async function loadFigures() {
  const status = $("[data-stats-status]");
  // One attestation is enough: the listing's paid places cover the whole release.
  const [rewards, listing] = await Promise.all([
    withTimeout((signal) => fetchRewards(window.fetch.bind(window), { signal })),
    withTimeout((signal) => fetchListing(window.fetch.bind(window), { limit: 1, signal })),
  ]);
  if (rewards.ok) renderRewards(rewards.rewards);
  if (listing.ok) renderListing(listing.listing);

  if (rewards.ok && listing.ok) {
    renderNextReward(rewards.rewards, listing.listing);
    $("[data-stats]").hidden = false;
    status.textContent = "";
    return;
  }
  // Half the figures would read as a broken page, so the row shows only when both arrived.
  $("[data-stats]").hidden = true;
  status.textContent = "Couldn't load live figures.";
  status.appendChild(document.createTextNode(" "));
  const retry = el("button", "link-button", "Try again");
  retry.type = "button";
  retry.addEventListener("click", () => {
    status.textContent = "Loading…";
    loadFigures();
  });
  status.appendChild(retry);
}

setUpCopy();
loadFigures();
