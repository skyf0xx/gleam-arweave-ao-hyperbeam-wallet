// attest.html. The link's fragment is untrusted: it is decoded, then shown as
// text only. The extension re-checks the whole attestation before it signs.
import { STORE_URL, decodeAttestationFragment, describeOutcome, isFinal, sendAttestation } from "./scan-lib.js";

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
  $("[data-footnote]").hidden = false;

  let busy = false;
  const submit = async () => {
    if (busy) return;
    busy = true;
    sign.disabled = true;
    sign.textContent = "Waiting for Gleam\u2026";
    result.hidden = true;
    const outcome = await sendAttestation(window.chrome && window.chrome.runtime, attestation);
    busy = false;
    sign.disabled = false;
    sign.textContent = "Try again";
    show(describeOutcome(outcome), attestation);
  };

  function show(out, att) {
    const view = {
      text: out.message,
      tone: out.state === "success" || out.state === "full" || out.state === "unpaid" ? "good" : "bad",
    };
    const entry = `scan.html?v=${encodeURIComponent(att.release)}`;
    if (out.action === "store") {
      view.href = STORE_URL;
      view.linkText = "Add Gleam to Chrome";
      view.helpText = "Once it's installed and you've joined Gleam Points, click Try again.";
    } else if (out.action === "view") {
      view.href = out.attestationId ? `${entry}#${out.attestationId}` : entry;
      view.linkText = out.state === "already" ? "See the scans for this release" : "See your scan";
    } else if (out.action === "agent") {
      view.href = "scan.html";
      view.linkText = "Start a new scan";
    } else if (out.action === "wallet") {
      view.helpText = "Then click Try again.";
    }
    // Once there is nothing left to sign, or signing can't work, the button steps aside.
    sign.hidden = isFinal(out);
    showResult(view);
  }

  sign.addEventListener("click", submit);
}
