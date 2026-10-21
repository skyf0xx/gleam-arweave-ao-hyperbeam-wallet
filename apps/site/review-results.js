/* global AbortController, URL */
// review-results.html. Everything from the points API (labels, reports,
// function names) is untrusted text: nodes are built with textContent, never markup.
import { coverageSummary, fetchListing, idFromHash, releaseFromSearch, unusedModels } from "./scan-lib.js";

const $ = (selector) => document.querySelector(selector);
const PAGES_UP_FRONT = 5;
const LISTING_TIMEOUT_MS = 8000;
const RESULTS = new Set(["pass", "scanned"]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const state = { release: null, listing: null, attestations: [], nextCursor: null, loading: false };

async function loadPage(cursor) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), LISTING_TIMEOUT_MS);
  const result = await fetchListing(window.fetch.bind(window), { release: state.release, cursor, signal: controller.signal });
  window.clearTimeout(timer);
  return result;
}

function failure(message) {
  const status = $("[data-load-status]");
  status.textContent = `${message} `;
  const retry = el("button", "link-button", "Try again");
  retry.type = "button";
  retry.addEventListener("click", () => {
    status.textContent = "Loading reviews…";
    loadRelease();
  });
  status.appendChild(retry);
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderCoverage(listing) {
  const text = $("[data-coverage-text]");
  const bar = $("[data-coverage-bar]");
  const summary = coverageSummary(listing.coverage);
  const details = $("[data-unexamined]");
  const none = $("[data-unexamined-none]");
  details.hidden = true;
  none.hidden = true;
  if (!summary) {
    text.textContent = "Coverage isn't available right now.";
    $("[data-coverage-figure]").textContent = "–";
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  text.textContent = `${summary.text}.`;
  $("[data-coverage-figure]").textContent = `${Math.floor(summary.share * 100)}%`;
  bar.setAttribute("aria-label", summary.text);
  $("[data-coverage-fill]").style.width = `${(summary.share * 100).toFixed(1)}%`;
  if (summary.unexamined === null) return;
  if (summary.unexamined.length === 0) {
    none.hidden = false;
    return;
  }
  details.hidden = false;
  $("[data-unexamined-summary]").textContent = `Functions nobody has examined (${summary.unexamined.length})`;
  const list = $("[data-unexamined-list]");
  list.textContent = "";
  for (const fn of summary.unexamined) list.appendChild(el("li", "", `${fn.file} → ${fn.symbol}`));
}

// A small arrow-out-of-box glyph: no icon font, just an inline SVG path.
const LINK_ICON_PATH = "M7 1h6v6M13 1 6 8M4 3H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2";

function permalink(id) {
  const url = new URL(location.href);
  url.hash = id;
  return url.href;
}

function renderAttestation(att) {
  const item = el("li", "att");
  item.id = att.id;
  const details = el("details", "att-details");
  const summary = el("summary", "att-summary");
  const result = String(att.result);
  summary.appendChild(el("span", "att-model", String(att.model)));
  const tag = el("span", "att-tag", result);
  if (RESULTS.has(result)) tag.dataset.result = result;
  summary.appendChild(tag);
  summary.appendChild(el("span", "att-meta", [formatDate(att.createdAt), att.paid ? "paid" : "no points"].filter(Boolean).join(" · ")));
  details.appendChild(summary);

  const body = el("div", "att-body");
  body.appendChild(el("p", "small", "Report"));
  body.appendChild(el("pre", "report", String(att.report)));
  const foot = el("div", "att-foot");
  const id = el("span", "small sc-mono att-id", `Attestation ${att.id}`);
  id.title = String(att.id);
  foot.appendChild(id);
  const link = document.createElement("a");
  link.className = "att-link";
  link.href = permalink(att.id);
  link.target = "_blank";
  link.rel = "noopener";
  link.setAttribute("aria-label", "Open this attestation in a new tab");
  link.title = "Open this attestation in a new tab";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", LINK_ICON_PATH);
  svg.appendChild(path);
  link.appendChild(svg);
  foot.appendChild(link);
  body.appendChild(foot);
  details.appendChild(body);
  item.appendChild(details);
  return item;
}

function renderAttestations() {
  const list = $("[data-attestations]");
  list.textContent = "";
  for (const att of state.attestations) list.appendChild(renderAttestation(att));
  $("[data-attestations-empty]").hidden = state.attestations.length > 0;
  $("[data-more]").hidden = state.nextCursor === null;

  // The server's list covers every attestation of the release, not just the pages loaded so far.
  const labels = Array.isArray(state.listing.models) ? state.listing.models : state.attestations.map((att) => att.model);
  const unused = unusedModels(labels.map(String));
  const used = new Set(labels.map(String)).size;
  $("[data-models-used]").textContent = String(used);
  const version = `v${state.listing.release}`;
  const modelList = $("[data-models-list]");
  modelList.textContent = "";
  if (unused.length > 0) {
    $("[data-models-text]").textContent = `Not yet used on ${version}:`;
    for (const name of unused) modelList.appendChild(el("li", "chip", name));
    modelList.hidden = false;
    $("[data-models-note]").hidden = false;
  } else {
    $("[data-models-text]").textContent = `Every model on our list has been used on ${version}.`;
    modelList.hidden = true;
    $("[data-models-note]").hidden = true;
  }
}

function revealTarget() {
  const id = idFromHash(location.hash);
  if (!id) return;
  const item = document.getElementById(id);
  if (!item) return;
  for (const other of document.querySelectorAll(".att-target")) other.classList.remove("att-target");
  item.querySelector("details").open = true;
  item.classList.add("att-target");
  item.scrollIntoView({ block: "center" });
}

async function loadMore() {
  if (state.loading || state.nextCursor === null) return;
  state.loading = true;
  const button = $("[data-more]");
  const error = $("[data-more-error]");
  button.disabled = true;
  error.hidden = true;
  const result = await loadPage(state.nextCursor);
  state.loading = false;
  button.disabled = false;
  if (!result.ok) {
    error.textContent = `${result.error} Try again.`;
    error.hidden = false;
    return;
  }
  state.attestations = state.attestations.concat(result.listing.attestations);
  state.nextCursor = result.listing.nextCursor;
  renderAttestations();
}

async function loadRelease() {
  state.release = releaseFromSearch(location.search);
  const first = await loadPage(null);
  if (!first.ok) {
    failure(first.error);
    return;
  }
  state.listing = first.listing;
  state.attestations = first.listing.attestations;
  state.nextCursor = first.listing.nextCursor;
  document.title = `Gleam review results · v${first.listing.release}`;
  $("[data-release-title]").textContent = `Reviews of v${first.listing.release}`;
  $("[data-paid-left]").textContent = String(Math.max(0, first.listing.paidPlacesLeft));

  // A link to one entry needs it loaded.
  const wanted = idFromHash(location.hash);
  for (let page = 1; wanted && page < PAGES_UP_FRONT && state.nextCursor !== null; page++) {
    if (state.attestations.some((att) => att.id === wanted)) break;
    const next = await loadPage(state.nextCursor);
    if (!next.ok) break;
    state.attestations = state.attestations.concat(next.listing.attestations);
    state.nextCursor = next.listing.nextCursor;
  }

  $("[data-load-status]").hidden = true;
  $("[data-release-body]").hidden = false;
  renderCoverage(first.listing);
  renderAttestations();
  revealTarget();
}

$("[data-more]").addEventListener("click", loadMore);
window.addEventListener("hashchange", revealTarget);
loadRelease();
