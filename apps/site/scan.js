/* global AbortController */
// scan.html. Everything from the points API (labels, reports, answers, function
// names) is untrusted text: nodes are built with textContent, never markup.
import { AGENT_LINE, coverageSummary, fetchListing, idFromHash, releaseFromSearch, unusedModels } from "./scan-lib.js";

const $ = (selector) => document.querySelector(selector);
const PAGES_UP_FRONT = 5;
const LISTING_TIMEOUT_MS = 8000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// --- The line to paste ------------------------------------------------------

function setUpCopy() {
  const line = $("[data-agent-line]");
  const status = $("[data-copy-status]");
  line.textContent = AGENT_LINE;
  let timer = 0;
  const done = (ok) => {
    status.textContent = ok ? "Copied" : "Select the line and copy it.";
    line.toggleAttribute("data-copied", ok);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      status.textContent = "";
      line.removeAttribute("data-copied");
    }, 2500);
  };
  line.addEventListener("click", () => {
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
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(AGENT_LINE).then(() => done(true), fallback);
    } else {
      fallback();
    }
  });
}

// --- The release ------------------------------------------------------------

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
  status.textContent = message + " Reload the page to try again.";
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
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  text.textContent = summary.text;
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

function renderPaid(listing) {
  const left = listing.paidPlacesLeft;
  $("[data-paid-text]").textContent = left > 0 ? `${left} of 20 paid places left` : "All 20 paid places are taken";
}

function renderAttestation(att) {
  const item = el("li", "att");
  item.id = att.id;
  const details = el("details", "att-details");
  const summary = el("summary", "att-summary");
  summary.appendChild(el("span", "att-model", String(att.model)));
  summary.appendChild(el("span", "att-tag", String(att.result)));
  summary.appendChild(el("span", "att-meta", [formatDate(att.createdAt), att.paid ? "paid" : "no points"].filter(Boolean).join(" · ")));
  details.appendChild(summary);

  const body = el("div", "att-body");
  body.appendChild(el("p", "small", "Report"));
  body.appendChild(el("pre", "report", String(att.report)));
  const answers = Array.isArray(att.answers) ? att.answers : [];
  body.appendChild(el("p", "small", "Challenge answers"));
  const list = el("ol", "answers");
  for (const answer of answers) {
    const row = el("li");
    row.appendChild(el("span", "sc-mono", `${answer.file} → ${answer.symbol}, line ${answer.line}`));
    row.appendChild(el("span", "answer-check", String(answer.check)));
    list.appendChild(row);
  }
  body.appendChild(list);
  body.appendChild(el("p", "small sc-mono att-id", `Attestation id ${att.id}`));
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
  const version = `v${state.listing.release}`;
  $("[data-models-text]").textContent =
    unused.length > 0
      ? `Not yet used on ${version}: ${unused.join(", ")}`
      : `Every model on our list has been used on ${version}.`;
}

function revealTarget() {
  const id = idFromHash(location.hash);
  if (!id) return;
  const item = document.getElementById(id);
  if (!item) return;
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
    failure(first.status === 404 ? first.error : `${first.error}`);
    return;
  }
  state.listing = first.listing;
  state.attestations = first.listing.attestations;
  state.nextCursor = first.listing.nextCursor;
  document.title = `Gleam community scans · v${first.listing.release}`;
  $("[data-release-title]").textContent = `Release v${first.listing.release}`;

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
  renderPaid(first.listing);
  renderAttestations();
  revealTarget();
}

setUpCopy();
$("[data-more]").addEventListener("click", loadMore);
window.addEventListener("hashchange", revealTarget);
loadRelease();
