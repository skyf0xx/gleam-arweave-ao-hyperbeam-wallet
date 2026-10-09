// Shared by welcome.html, feedback.html and goodbye.html, the pages the
// extension opens, and by invite.html, points.html and future.html. The extension passes only its
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

  if (document.body.hasAttribute("data-invite")) {
    var code = (params.get("c") || "").trim().toUpperCase();
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
    }
  }

  function handOverInvite() {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(INVITE_KEY) || "null");
    } catch {
      return;
    }
    if (!saved || !INVITE_CODE.test(saved.code) || Date.now() - saved.savedAt > INVITE_MAX_AGE_MS) return;
    // window.chrome.runtime exists here only because the extension's
    // manifest lists this site under externally_connectable.
    var runtime = window.chrome && window.chrome.runtime;
    if (!runtime || !runtime.sendMessage) return;
    runtime.sendMessage(EXTENSION_ID, { type: "gleam-points:invite", code: saved.code }, function (reply) {
      // Reading lastError tells Chrome it was handled, which keeps a
      // missing listener out of the console.
      if (runtime.lastError) return;
      if (reply && reply.ok) {
        trackOnce("gleam-invite-handoff", { version: version || "unknown" });
        try {
          localStorage.removeItem(INVITE_KEY);
        } catch {
          // Nothing to clean up if storage is blocked.
        }
      }
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

  // future.html: the founding count comes from the points server. Until it
  // answers with a real positive number the element stays hidden, so a
  // down server never shows a zero or a placeholder.
  var foundingCount = document.querySelector("[data-founding-count]");
  if (foundingCount && window.fetch) {
    var controller = window.AbortController ? new window.AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, 5000);
    fetch("https://gleam-points.up.railway.app/stats", controller ? { signal: controller.signal } : undefined)
      .then(function (res) {
        if (!res.ok) throw new Error("stats " + res.status);
        return res.json();
      })
      .then(function (body) {
        var n = body && body.foundingMembers;
        if (typeof n !== "number" || !isFinite(n) || n < 1 || Math.floor(n) !== n) return;
        foundingCount.querySelector("[data-founding-number]").textContent = new Intl.NumberFormat("en-US").format(n);
        foundingCount.hidden = false;
      })
      .catch(function () {
        // Leave the count hidden.
      })
      .then(function () {
        clearTimeout(timer);
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
