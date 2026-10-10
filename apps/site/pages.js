// Shared by welcome.html, feedback.html and goodbye.html, the pages the
// extension opens, and by invite.html, points.html and gleam.html. The extension passes only its
// version (?v=), never anything about the user or their wallet.
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var version = (params.get("v") || "").slice(0, 32);

  // Gleam Points invites (POINTS.md § Attribution). A Chrome Web Store
  // install can't carry the code, so invite.html keeps it in this site's
  // localStorage and welcome.html, which the extension opens on first
  // install, hands it to the extension.
  var EXTENSION_ID = "einabcphdmlicabnjllaaallnebfkmki";
  var INVITE_KEY = "gleam:inviteCode";
  var INVITE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  var INVITE_CODE = /^[A-Z0-9]{6,16}$/;

  // Set once an installed Gleam has taken the code, so the page's own
  // states can't reappear over the "ready" message.
  var handedOverToInstalled = false;

  if (document.body.hasAttribute("data-invite")) {
    var code = (params.get("c") || params.get("code") || "").trim().toUpperCase();
    if (INVITE_CODE.test(code)) {
      try {
        localStorage.setItem(INVITE_KEY, JSON.stringify({ code: code, savedAt: Date.now() }));
      } catch {
        // Storage blocked: the code shown below can still be typed in.
      }
      var codeLine = document.querySelector("[data-invite-code]");
      if (codeLine) {
        codeLine.querySelector("[data-invite-code-value]").textContent = code;
        codeLine.hidden = false;
      }
      // Counts invite visits. The code itself is never sent.
      trackOnce("gleam-invite-open", {});
      handOverToInstalled(code);
    }
  }

  // If Gleam is already installed in this browser (it's sitting on the
  // founding gate), hand the code straight to it so nobody has to type it.
  function handOverToInstalled(code) {
    var runtime = window.chrome && window.chrome.runtime;
    if (!runtime || !runtime.sendMessage) return;
    runtime.sendMessage(EXTENSION_ID, { type: "gleam-points:invite", code: code }, function (reply) {
      if (runtime.lastError || !reply || !reply.ok || reply.redeem !== "ok") return;
      try {
        localStorage.removeItem(INVITE_KEY);
      } catch {
        // Nothing to clean up if storage is blocked.
      }
      var ready = document.querySelector("[data-invite-ready]");
      if (!ready) return;
      handedOverToInstalled = true;
      document.querySelectorAll(".invite-state").forEach(function (el) {
        el.hidden = true;
      });
      ready.hidden = false;
    });
  }

  // Shows one of welcome.html's Phase 1 states (POINTS.md § Messaging).
  function showWelcome(name, code, notFound) {
    document.querySelectorAll("[data-welcome]").forEach(function (el) {
      el.hidden = el.getAttribute("data-welcome") !== name;
    });
    var codeEl = document.querySelector("[data-welcome-code]");
    if (codeEl && code) codeEl.textContent = code;
    var notFoundEl = document.querySelector("[data-welcome-not-found]");
    if (notFoundEl) notFoundEl.hidden = !notFound;
  }

  function handOverInvite() {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(INVITE_KEY) || "null");
    } catch {
      saved = null;
    }
    if (!saved || !INVITE_CODE.test(saved.code) || Date.now() - saved.savedAt > INVITE_MAX_AGE_MS) {
      showWelcome("none");
      return;
    }
    // Until the extension answers (or can't), say nothing about the code.
    // Without a reply the code is shown but success isn't claimed.
    var pending = function () {
      showWelcome("pending", saved.code);
    };
    // window.chrome.runtime exists here only because the extension's
    // manifest lists this site under externally_connectable.
    var runtime = window.chrome && window.chrome.runtime;
    if (!runtime || !runtime.sendMessage) {
      pending();
      return;
    }
    runtime.sendMessage(EXTENSION_ID, { type: "gleam-points:invite", code: saved.code }, function (reply) {
      // Reading lastError tells Chrome it was handled, which keeps a
      // missing listener out of the console.
      if (runtime.lastError || !reply || !reply.ok) {
        pending();
        return;
      }
      trackOnce("gleam-invite-handoff", { version: version || "unknown" });
      try {
        localStorage.removeItem(INVITE_KEY);
      } catch {
        // Nothing to clean up if storage is blocked.
      }
      if (reply.redeem === "ok") showWelcome("ready");
      else if (reply.redeem === "full") showWelcome("full");
      else if (reply.redeem === "unknown") showWelcome("none", "", true);
      else pending();
    });
  }

  // Umami loads deferred alongside this script, so an event fired before
  // it's ready waits for the page's load event.
  function trackOnce(name, data) {
    var send = function () {
      try {
        if (sessionStorage.getItem(name)) return;
        sessionStorage.setItem(name, "1");
      } catch {
        // Storage blocked: count it anyway.
      }
      if (window.umami) window.umami.track(name, data);
    };
    if (document.readyState === "complete") send();
    else window.addEventListener("load", send);
  }

  // Calls the points server. Resolves to the parsed body, or null on any
  // failure (down, slow, non-2xx), so callers fall back to showing nothing.
  var POINTS_API = "https://gleam-points.up.railway.app";

  function callPointsApi(path, body) {
    if (!window.fetch) return Promise.resolve(null);
    var controller = window.AbortController ? new window.AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, 5000);
    var init = controller ? { signal: controller.signal } : {};
    if (body) {
      init.method = "POST";
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    return fetch(POINTS_API + path, init)
      .then(function (res) {
        if (!res.ok) throw new Error(path + " " + res.status);
        return res.json();
      })
      .catch(function () {
        return null;
      })
      .then(function (result) {
        clearTimeout(timer);
        return result;
      });
  }

  if (document.body.hasAttribute("data-invite")) setUpInvitePage();

  // invite.html (POINTS.md § Messaging). The page opens in the invite state
  // when a well-formed code is in the URL and switches to the ask state if
  // the server says the code is unknown or full. If the server can't be
  // reached the invite state stays, without seats.
  var MEMBER_SEATS = 3;

  function setUpInvitePage() {
    var inviteCode = (params.get("c") || params.get("code") || "").trim().toUpperCase();
    if (!INVITE_CODE.test(inviteCode)) inviteCode = "";
    var states = {};
    document.querySelectorAll("[data-state]").forEach(function (el) {
      states[el.getAttribute("data-state")] = el;
    });
    var seatsEl = document.querySelector("[data-seats]");
    var countdownEl = document.querySelector("[data-countdown]");
    var notFound = document.querySelector("[data-not-found]");

    function show(name) {
      if (handedOverToInstalled) return;
      Object.keys(states).forEach(function (key) {
        states[key].hidden = key !== name;
      });
    }

    // The kind (never the code) rides along on the page's click events.
    function tagKind(kind) {
      document.querySelectorAll("[data-umami-event]").forEach(function (el) {
        el.setAttribute("data-umami-event-kind", kind);
      });
    }

    function seatsText(kind, left) {
      if (typeof left !== "number" || left < 0) return "";
      if (kind === "member" && left <= MEMBER_SEATS) return left + " of " + MEMBER_SEATS + " seats left";
      return left + (left === 1 ? " seat left" : " seats left");
    }

    // Drop links carry the close time as ?until=<ISO date>; the server has
    // no such field. Past or unparseable dates show nothing.
    var until = Date.parse(params.get("until") || "");
    var countdownTimer = 0;

    function tickCountdown() {
      var ms = until - Date.now();
      if (!(ms > 0)) {
        countdownEl.hidden = true;
        window.clearInterval(countdownTimer);
        return;
      }
      var mins = Math.floor(ms / 60000);
      var d = Math.floor(mins / 1440);
      var h = Math.floor((mins % 1440) / 60);
      var m = mins % 60;
      var text = d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : Math.max(m, 1) + "m";
      countdownEl.querySelector("[data-countdown-text]").textContent = text;
      countdownEl.hidden = false;
    }

    function showCountdown() {
      if (!countdownEl || !isFinite(until)) return;
      tickCountdown();
      countdownTimer = window.setInterval(tickCountdown, 30000);
    }

    if (!inviteCode) {
      show("none");
      return;
    }
    show("code");

    callPointsApi("/invite/check", { code: inviteCode }).then(function (res) {
      if (!res || typeof res.exists !== "boolean") {
        showCountdown();
        return;
      }
      if (!res.exists) {
        if (notFound) notFound.hidden = false;
        show("none");
        return;
      }
      var kind = res.kind === "drop" ? "drop" : res.kind === "member" ? "member" : "";
      if (kind) {
        tagKind(kind);
        trackOnce("gleam-invite-code-kind", { kind: kind });
      }
      if (res.seatsLeft === 0) {
        show("full");
        return;
      }
      var text = seatsText(kind, res.seatsLeft);
      if (seatsEl && text) {
        seatsEl.textContent = text;
        seatsEl.hidden = false;
      }
      if (kind === "drop") showCountdown();
    });
  }

  var calc = document.querySelector("form[data-points-calc]");
  if (calc) setUpCalculator(calc);

  // Mirrors POINTS.md § Rules: 1 point per AR or AO a day up to 100, a
  // square-root curve above that, +10% for an invited wallet, and 10% of
  // each invited friend's points.
  function curve(balance) {
    return balance <= 100 ? balance : 2 * Math.sqrt(100 * balance) - 100;
  }

  function setUpCalculator(form) {
    var fields = form.elements;
    var format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
    var touched = false;

    function read(name) {
      var value = parseFloat(fields[name].value);
      return isFinite(value) && value > 0 ? value : 0;
    }

    function update() {
      var friends = Math.round(read("friends"));
      fields.friendsOut.value = String(friends);
      form.querySelector("[data-friends-word]").textContent = friends === 1 ? "friend" : "friends";
      var balance = curve(read("ar") + read("ao"));
      var bonus = fields.invited.checked ? balance * 0.1 : 0;
      var fromFriends = friends * curve(read("friendAr") + read("friendAo")) * 0.1;
      var perDay = balance + bonus + fromFriends;
      form.querySelector('[data-out="day"]').textContent = format.format(perDay);
      form.querySelector('[data-out="month"]').textContent = format.format(perDay * 30);
      form.querySelector('[data-out="year"]').textContent = format.format(perDay * 365);
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
    });
    form.addEventListener("input", function () {
      update();
      if (!touched) {
        touched = true;
        trackOnce("points-calculator-used", {});
      }
    });
    update();
  }

  var event = document.body.getAttribute("data-event");
  if (event === "gleam-installed") handOverInvite();

  // Only count a visit the extension opened (it always passes ?v=), so
  // someone landing here from a search or a shared link isn't an install.
  // sessionStorage stops a reload from counting twice.
  if (event && version) {
    window.addEventListener("load", function () {
      try {
        if (sessionStorage.getItem(event)) return;
        sessionStorage.setItem(event, "1");
      } catch {
        // Storage blocked: count it anyway.
      }
      if (window.umami) window.umami.track(event, { version: version });
    });
  }

  var form = document.querySelector("form[data-web3forms]");
  if (!form) return;

  var versionInput = form.querySelector('input[name="version"]');
  if (versionInput) versionInput.value = version || "unknown";
  var browserInput = form.querySelector('input[name="browser"]');
  if (browserInput) browserInput.value = navigator.userAgent;

  var button = form.querySelector('button[type="submit"]');
  var status = form.querySelector(".status");
  var sent = document.getElementById(form.getAttribute("data-sent"));

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    button.disabled = true;
    status.removeAttribute("data-state");
    status.textContent = "Sending…";

    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body.success) throw new Error(body.message || "Send failed");
        });
      })
      .then(function () {
        var sentEvent = form.getAttribute("data-sent-event");
        if (sentEvent && window.umami) {
          // The reason is one of the fixed choices, never the free text.
          var reason = form.querySelector('input[name="reason"]:checked');
          var data = { version: version || "unknown" };
          if (reason) data.reason = reason.value;
          window.umami.track(sentEvent, data);
        }
        form.hidden = true;
        if (sent) sent.hidden = false;
      })
      .catch(function () {
        status.setAttribute("data-state", "error");
        status.textContent = "That didn't send. Check your connection and try again.";
        button.disabled = false;
      });
  });
})();
