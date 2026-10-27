// attest.html. The link's fragment is untrusted: it is decoded, then shown as
// text only. The extension re-checks the whole attestation before it signs.
import {
  STORE_URL,
  checkGleam,
  decodeAttestationFragment,
  describeOutcome,
  isFinal,
  resultsHref,
  sendAttestation,
} from "./scan-lib.js";

const $ = (selector) => document.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const decoded = decodeAttestationFragment(location.hash);
const result = $("[data-result]");
const message = $("[data-result-message]");
const link = $("[data-result-link]");
const help = $("[data-result-help]");
const sign = $("[data-sign]");
const step = $("[data-sign-step]");
const install = $("[data-install]");
const SITE_HOST = "gleamwallet.app";
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
// Chrome lets only the extension's externally_connectable origins see it, so a
// preview deployment looks exactly like a browser without Gleam.
const ELSEWHERE = !LOCAL && location.hostname !== SITE_HOST;

// The step each readiness shows above the button, and what the button says.
const STEPS = {
  "no-extension": ELSEWHERE
    ? `Gleam only answers pages on ${SITE_HOST}, so it can't sign from this copy of the site. Open this link there instead.`
    : LOCAL
    ? "Gleam isn't reachable from this page. Add it to Chrome and reload, or for an unpacked build add ?ext=<its extension id> to the address."
    : "Gleam isn't installed in this browser. Add it to Chrome, then reload this page.",
  "no-wallet": "Gleam has no wallet yet. Create one and join Gleam Points, then come back to this tab.",
  unsupported: "Your active wallet can't sign for Gleam Points. Switch to another wallet in Gleam, then come back to this tab.",
  "not-joined": "Your active wallet hasn't joined Gleam Points. Join from Gleam's Points screen, then come back to this tab.",
};

function showResult({ text, tone, href, linkText, helpText }) {
  result.hidden = false;
  result.setAttribute("data-tone", tone);
  message.textContent = text;
  link.hidden = !href;
  if (href) {
    link.href = href;
    link.textContent = linkText;
  }
  help.hidden = !helpText;
  help.textContent = helpText || "";
  result.focus();
}

if (!decoded.ok) {
  $("[data-title]").textContent = "This link doesn't work";
  showResult({ text: decoded.error, tone: "bad", href: "scan.html", linkText: "How community scans work" });
} else {
  const attestation = decoded.attestation;
  $("[data-title]").textContent = `Sign your scan of v${attestation.release}`;
  $("[data-f-release]").textContent = `v${attestation.release}`;
  $("[data-f-model]").textContent = attestation.model;
  $("[data-f-result]").textContent =
    attestation.result === "pass" ? "pass (nothing reported)" : "scanned (a fix PR or an advisory was filed)";
  $("[data-f-commit]").textContent = attestation.commit;
  $("[data-f-report]").textContent = attestation.report;
  $("[data-f-answers-summary]").textContent = `Challenge answers (${attestation.answers.length})`;
  const list = $("[data-f-answers]");
  for (const answer of attestation.answers) {
    const row = el("li");
    row.appendChild(el("span", "sc-mono", `${answer.file} → ${answer.symbol}, line ${answer.line}`));
    row.appendChild(el("span", "answer-check", answer.check));
    list.appendChild(row);
  }
  $("[data-review]").hidden = false;
  // The app claims this subdomain; it opens the link there, or falls back to this page.
  const openApp = $("[data-open-app]");
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    openApp.href = `https://open.gleamwallet.app/attest${location.hash}`;
    openApp.hidden = false;
  }
  $("[data-footnote]").hidden = false;

  let busy = false;
  let final = false;
  let readiness = null;
  let tried = false;

  function render() {
    const text = STEPS[readiness];
    step.hidden = !text;
    step.textContent = text || "";
    install.hidden = readiness !== "no-extension";
    install.href = ELSEWHERE ? `https://${SITE_HOST}${location.pathname}${location.hash}` : STORE_URL;
    install.textContent = ELSEWHERE ? `Open on ${SITE_HOST}` : "Add Gleam to Chrome";
    sign.hidden = final || readiness === "no-extension";
    sign.disabled = false;
    sign.textContent = readiness === "ready" ? (tried ? "Try again" : "Sign with Gleam") : "Check again";
  }

  const refresh = async () => {
    if (busy || final) return;
    busy = true;
    const next = await checkGleam(window.chrome && window.chrome.runtime);
    busy = false;
    if (final) return;
    // A message about an earlier attempt no longer applies once the next step has changed.
    if (readiness !== null && next !== readiness) result.hidden = true;
    readiness = next;
    render();
  };

  const submit = async () => {
    if (busy) return;
    busy = true;
    tried = true;
    sign.disabled = true;
    sign.textContent = "Waiting for Gleam\u2026";
    result.hidden = true;
    const outcome = await sendAttestation(window.chrome && window.chrome.runtime, attestation);
    busy = false;
    show(describeOutcome(outcome), attestation);
  };

  function show(out, att) {
    if (out.state === "no-extension") {
      readiness = "no-extension";
      render();
      return;
    }
    const view = {
      text: out.message,
      tone: out.state === "success" || out.state === "full" || out.state === "unpaid" ? "good" : "bad",
    };
    if (out.action === "view") {
      view.href = resultsHref(att.release, out.attestationId);
      view.linkText = out.state === "already" ? "See the scans for this release" : "See your scan";
    } else if (out.action === "agent") {
      view.href = "scan.html";
      view.linkText = "Start a new scan";
    } else if (out.action === "wallet") {
      view.helpText = "Then click Try again.";
    }
    // Once there is nothing left to sign, or signing can't work, the button steps aside.
    final = isFinal(out);
    render();
    showResult(view);
  }

  sign.addEventListener("click", () => (readiness === "ready" ? submit() : refresh()));
  // Joining Points or switching wallets happens in Gleam's own window, so look again on the way back.
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  void refresh();
}
