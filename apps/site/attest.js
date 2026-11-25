// attest.html. The link's fragment is untrusted: it is decoded, then shown as
// text only. The extension re-checks the whole attestation before it signs.
// A link carries one payload, or one per round (`#<p1>.<p2>…`) when an agent
// scanned several areas; Gleam takes one attestation per request, each in its
// own approval window, so rounds are signed one click at a time.
import {
  STORE_URL,
  $,
  el,
  formatPoints,
} from "./scan-lib.js";
import {
  appAttestHref,
  checkGleam,
  decodeAttestationLink,
  describeOutcome,
  isFinal,
  roundSummary,
  sendAttestation,
  sumPoints,
} from "./scan-attest.js";
import {
  resultsHref,
} from "./scan-api.js";

const link = decodeAttestationLink(location.hash);
const result = $("[data-result]");
const message = $("[data-result-message]");
const resultLink = $("[data-result-link]");
const help = $("[data-result-help]");
const signBlock = $("[data-sign-block]");
const sign = $("[data-sign]");
const skip = $("[data-skip]");
const step = $("[data-sign-step]");
const install = $("[data-install]");
const SITE_HOST = "gleamwallet.app";
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
// Chrome lets only the extension's externally_connectable origins see it, so a
// preview deployment looks exactly like a browser without Gleam.
const ELSEWHERE = !LOCAL && location.hostname !== SITE_HOST;
const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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
  resultLink.hidden = !href;
  if (href) {
    resultLink.href = href;
    resultLink.textContent = linkText;
  }
  help.hidden = !helpText;
  help.textContent = helpText || "";
  result.focus();
}

function renderStep(readiness) {
  const text = STEPS[readiness];
  step.hidden = !text;
  step.textContent = text || "";
  install.hidden = readiness !== "no-extension";
  install.href = ELSEWHERE ? `https://${SITE_HOST}${location.pathname}${location.hash}` : STORE_URL;
  install.textContent = ELSEWHERE ? `Open on ${SITE_HOST}` : "Add Gleam to Chrome";
}

/**
 * Keeps the readiness check current: on load, and whenever the tab comes
 * back, since joining Points or switching wallets happens in Gleam's own
 * window. `isIdle` says whether a check may run now; `onChange` gets the
 * new readiness and whether it differs from the last one.
 */
function watchReadiness(isIdle, onChange) {
  let checking = false;
  let last = null;
  const refresh = async () => {
    if (checking || !isIdle()) return;
    checking = true;
    const next = await checkGleam(window.chrome && window.chrome.runtime);
    checking = false;
    if (!isIdle()) return;
    const changed = last !== null && next !== last;
    last = next;
    onChange(next, changed);
  };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  void refresh();
  return {
    refresh,
    set(value) {
      last = value;
    },
  };
}

function resultLabel(attestation) {
  return attestation.result === "pass" ? "pass (nothing reported)" : "scanned (an advisory was filed)";
}

function fillAnswers(list, attestation) {
  for (const answer of attestation.answers) {
    const row = el("li");
    row.appendChild(el("span", "sc-mono", `${answer.file} → ${answer.symbol}, line ${answer.line}`));
    row.appendChild(el("span", "answer-check", answer.check));
    list.appendChild(row);
  }
}

if (!link.ok) {
  $("[data-title]").textContent = "This link doesn't work";
  showResult({ text: link.error, tone: "bad", href: "scan.html", linkText: "How community scans work" });
} else if (link.rounds.length === 1) {
  signOne(link.rounds[0].attestation);
} else {
  signRounds(link.rounds);
}

function signOne(attestation) {
  $("[data-title]").textContent = `Sign your scan of v${attestation.release}`;
  $("[data-f-release]").textContent = `v${attestation.release}`;
  $("[data-f-model]").textContent = attestation.model;
  $("[data-f-result]").textContent = resultLabel(attestation);
  $("[data-f-commit]").textContent = attestation.commit;
  $("[data-f-report]").textContent = attestation.report;
  $("[data-f-answers-summary]").textContent = `Challenge answers (${attestation.answers.length})`;
  fillAnswers($("[data-f-answers]"), attestation);
  $("[data-review]").hidden = false;
  signBlock.hidden = false;
  // The app claims this subdomain; it opens the link there, or falls back to this page.
  const openApp = $("[data-open-app]");
  if (MOBILE) {
    openApp.href = `https://open.gleamwallet.app/attest${location.hash}`;
    openApp.hidden = false;
  }

  let busy = false;
  let final = false;
  let readiness = null;
  let tried = false;

  function render() {
    renderStep(readiness);
    sign.hidden = final || readiness === "no-extension";
    sign.disabled = false;
    sign.textContent = readiness === "ready" ? (tried ? "Try again" : "Sign with Gleam") : "Check again";
  }

  const watcher = watchReadiness(
    () => !busy && !final,
    (next, changed) => {
      // A message about an earlier attempt no longer applies once the next step has changed.
      if (changed) result.hidden = true;
      readiness = next;
      render();
    },
  );

  const submit = async () => {
    if (busy) return;
    busy = true;
    tried = true;
    sign.disabled = true;
    sign.textContent = "Waiting for Gleam…";
    result.hidden = true;
    const outcome = await sendAttestation(window.chrome && window.chrome.runtime, attestation);
    busy = false;
    show(describeOutcome(outcome));
  };

  function show(out) {
    if (out.state === "no-extension") {
      readiness = "no-extension";
      watcher.set(readiness);
      render();
      return;
    }
    const view = {
      text: out.message,
      tone: out.state === "success" || out.state === "full" || out.state === "unpaid" ? "good" : "bad",
    };
    if (out.action === "view") {
      view.href = resultsHref(attestation.release, out.attestationId);
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

  sign.addEventListener("click", () => (readiness === "ready" ? submit() : watcher.refresh()));
}

// --- Several rounds ---------------------------------------------------------

const SIGNED_STATES = new Set(["success", "full", "unpaid"]);

/**
 * Each round is "pending", "error" (an attempt failed and another may work),
 * or settled: "signed", "final" (signing it again can't help), "skipped" or
 * "damaged". The button stays on one round until it is settled, so "error"
 * is only ever the current round.
 */
function signRounds(decoded) {
  const total = decoded.length;
  const rounds = decoded.map((entry, index) => ({
    ...entry,
    label: `Round ${index + 1} of ${total}`,
    short: `round ${index + 1}`,
    status: entry.ok ? "pending" : "damaged",
    out: null,
  }));
  const releases = [...new Set(rounds.filter((round) => round.ok).map((round) => round.attestation.release))];
  const release = releases.length === 1 ? releases[0] : null;
  $("[data-title]").textContent = release ? `Sign ${total} rounds of v${release}` : `Sign ${total} rounds`;

  const status = $("[data-batch-status]");
  const list = $("[data-rounds]");
  for (const round of rounds) {
    round.node = buildRound(round);
    list.appendChild(round.node.item);
  }
  $("[data-batch]").hidden = false;
  signBlock.hidden = false;

  let busy = false;
  let readiness = null;
  let current = nextOpen(-1);

  function nextOpen(from) {
    for (let offset = 1; offset <= total; offset += 1) {
      const index = (from + offset + total) % total;
      if (rounds[index].status === "pending" || rounds[index].status === "error") return index;
    }
    return -1;
  }

  function buildRound(round) {
    const item = el("li", "round");
    const head = el("p", "round-head");
    head.appendChild(el("span", "round-label", round.label));
    const state = el("span", "round-state");
    head.appendChild(state);
    item.appendChild(head);
    item.appendChild(el("p", "round-summary", round.ok ? roundSummary(round.attestation) : round.error));
    const outcome = el("p", "round-result");
    outcome.hidden = true;
    item.appendChild(outcome);
    const actions = el("p", "round-actions");
    const view = el("a", "round-link");
    view.hidden = true;
    actions.appendChild(view);
    if (round.ok && MOBILE) {
      // The app's attest route takes one payload, so each round gets its own link.
      const openApp = el("a", "round-link", `Open ${round.short} in Gleam`);
      openApp.href = appAttestHref(round.payload);
      actions.appendChild(openApp);
      round.openApp = openApp;
    }
    item.appendChild(actions);
    if (round.ok) item.appendChild(buildDetails(round.attestation));
    return { item, state, outcome, view, actions };
  }

  function buildDetails(attestation) {
    const details = el("details", "sc-more");
    details.appendChild(el("summary", undefined, "Details"));
    const facts = el("dl", "facts");
    for (const [term, value, mono] of [
      ["Release", `v${attestation.release}`],
      ["Model", attestation.model],
      ["Result", resultLabel(attestation)],
      ["Commit", attestation.commit, true],
    ]) {
      const row = el("div");
      row.appendChild(el("dt", undefined, term));
      row.appendChild(el("dd", mono ? "sc-mono" : undefined, value));
      facts.appendChild(row);
    }
    details.appendChild(facts);
    details.appendChild(el("pre", "report", attestation.report));
    details.appendChild(el("p", "small round-answers-title", `Challenge answers (${attestation.answers.length})`));
    const answers = el("ol", "answers");
    fillAnswers(answers, attestation);
    details.appendChild(answers);
    return details;
  }

  const STATE_TEXT = {
    pending: "",
    error: "Not signed",
    signed: "Signed",
    final: "Can't be signed",
    skipped: "Skipped",
    damaged: "Can't be read",
  };

  function renderRound(round, index) {
    const { item, state, outcome, view, actions } = round.node;
    item.setAttribute("data-status", round.status);
    item.toggleAttribute("data-current", index === current);
    state.textContent = index === current && round.status === "pending" ? "Next" : STATE_TEXT[round.status];
    const out = round.out;
    outcome.hidden = !out;
    if (out) {
      outcome.textContent =
        out.state === "success" ? (out.paid ? `Earned ${formatPoints(out.points)} points.` : "Signed.") : out.message;
    }
    const viewable = out && out.action === "view";
    view.hidden = !viewable;
    if (viewable) {
      view.href = resultsHref(round.attestation.release, out.attestationId);
      view.textContent = out.state === "already" ? "See the scans for this release" : "See this round";
    }
    if (round.openApp) round.openApp.hidden = round.status === "signed" || round.status === "final";
    actions.hidden = [...actions.children].every((child) => child.hidden);
  }

  function render() {
    rounds.forEach(renderRound);
    if (current === -1) {
      finish();
      return;
    }
    const round = rounds[current];
    renderStep(readiness);
    sign.hidden = readiness === "no-extension";
    sign.disabled = busy || readiness === null;
    if (busy) sign.textContent = "Waiting for Gleam…";
    else if (readiness === null) sign.textContent = "Checking for Gleam…";
    else if (readiness !== "ready") sign.textContent = "Check again";
    else sign.textContent = round.status === "error" ? `Try ${round.short} again` : `Sign ${round.short} of ${total}`;
    skip.hidden = busy || round.status !== "error";
    skip.textContent = `Skip ${round.short}`;
  }

  function say(text) {
    status.hidden = !text;
    status.textContent = text;
    if (text) status.focus();
  }

  function settled(index) {
    current = nextOpen(index);
    if (current === -1) return;
    const done = rounds[index];
    const next = `Next: ${rounds[current].short} of ${total}.`;
    if (done.status === "signed") say(`${capital(done.short)} is signed. ${next}`);
    else if (done.status === "skipped") say(`Skipped ${done.short}. ${next}`);
    else say(`${capital(done.short)} can't be signed. ${next}`);
  }

  const watcher = watchReadiness(
    () => !busy && current !== -1,
    (next) => {
      readiness = next;
      render();
    },
  );

  const submit = async () => {
    if (busy || current === -1) return;
    const index = current;
    const round = rounds[index];
    busy = true;
    render();
    const outcome = await sendAttestation(window.chrome && window.chrome.runtime, round.attestation);
    busy = false;
    const out = describeOutcome(outcome);
    if (out.state === "no-extension") {
      readiness = "no-extension";
      watcher.set(readiness);
      say("");
      render();
      return;
    }
    round.out = out;
    if (SIGNED_STATES.has(out.state)) round.status = "signed";
    else if (isFinal(out)) round.status = "final";
    else round.status = "error";
    if (round.status === "error") {
      const after = nextOpen(index);
      const then = out.action === "wallet" ? "Then try again" : "Try again";
      say(
        after === -1 || after === index
          ? `${capital(round.short)} isn't signed. ${then}, or skip it.`
          : `${capital(round.short)} isn't signed. ${then}, or skip it and sign ${rounds[after].short}.`,
      );
    } else {
      settled(index);
    }
    render();
  };

  skip.addEventListener("click", () => {
    if (busy || current === -1) return;
    const index = current;
    rounds[index].status = "skipped";
    rounds[index].out = null;
    settled(index);
    render();
  });

  sign.addEventListener("click", () => (readiness === "ready" ? submit() : watcher.refresh()));

  function finish() {
    signBlock.hidden = true;
    const signed = rounds.filter((round) => round.status === "signed");
    const already = rounds.filter((round) => round.out && round.out.state === "already");
    const points = sumPoints(signed.map((round) => (round.out.paid ? round.out.points : "0")));
    const earned = points === "0" ? "" : ` You earned ${formatPoints(points)} points.`;
    const open = total - signed.length - already.length;
    const view = {
      text:
        open === 0
          ? `All ${total} rounds are signed.${earned}`
          : `${signed.length} of ${total} rounds are signed.${earned}`,
      tone: open === 0 ? "good" : "bad",
    };
    if (open > 0) view.helpText = 'Reply "signed" to your agent. It gives you a new link for the rest.';
    if (signed.length + already.length > 0) {
      view.href = resultsHref(release);
      view.linkText = "See the scans for this release";
    }
    status.hidden = true;
    showResult(view);
  }

  render();
}

function capital(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
