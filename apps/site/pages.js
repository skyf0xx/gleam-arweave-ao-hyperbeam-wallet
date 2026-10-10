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
    var code = (params.get("c") || params.get("code") || "")
      .trim()
      .toUpperCase();
    if (INVITE_CODE.test(code)) {
      try {
        localStorage.setItem(
          INVITE_KEY,
          JSON.stringify({ code: code, savedAt: Date.now() }),
        );
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
    runtime.sendMessage(
      EXTENSION_ID,
      { type: "gleam-points:invite", code: code },
      function (reply) {
        if (runtime.lastError || !reply || !reply.ok || reply.redeem !== "ok")
          return;
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
      },
    );
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
    if (
      !saved ||
      !INVITE_CODE.test(saved.code) ||
      Date.now() - saved.savedAt > INVITE_MAX_AGE_MS
    ) {
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
    runtime.sendMessage(
      EXTENSION_ID,
      { type: "gleam-points:invite", code: saved.code },
      function (reply) {
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
      },
    );
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
    var controller = window.AbortController
      ? new window.AbortController()
      : null;
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
    var inviteCode = (params.get("c") || params.get("code") || "")
      .trim()
      .toUpperCase();
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
      if (kind === "member" && left <= MEMBER_SEATS)
        return left + " of " + MEMBER_SEATS + " seats left";
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
      var text = d
        ? d + "d " + h + "h"
        : h
          ? h + "h " + m + "m"
          : Math.max(m, 1) + "m";
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
      var kind =
        res.kind === "drop" ? "drop" : res.kind === "member" ? "member" : "";
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
        // invite.html draws one seat per member-code seat from these
        seatsEl.setAttribute("data-left", String(res.seatsLeft));
        if (kind === "member")
          seatsEl.setAttribute("data-total", String(MEMBER_SEATS));
        seatsEl.hidden = false;
      }
      if (kind === "drop") showCountdown();
    });
  }

  // Ask-on-X posts open with an opinion about wallets rather than a plea,
  // so the poster reads as someone with taste. The link's static href is
  // the fallback when this script doesn't run.
  var ASK_LINES = [
    "A wallet should be the cleanest app on your screen, not the scariest.",
    "The best wallet is the one you never have to think about.",
    "Your wallet should work for you, not the other way around.",
    "Crypto is complicated enough. Your wallet shouldn't be.",
    "A wallet should feel like a window into crypto, not a cockpit.",
    "Crypto should feel simple. Your wallet should make it so.",
    "The best technology is the kind you barely notice.",
    "Less managing your crypto. More living with it.",
    "A wallet should be powerful underneath. Effortless on the surface.",
    "Your crypto deserves a better home.",
    "A wallet should open doors, not add steps.",
    "Crypto moves fast. Your wallet should keep up.",
    "Your wallet should make more possible, not more complicated.",
    "A good wallet earns your attention. A great one gives it back.",
    "The internet of value deserves a better front door.",
    "The future of money shouldn't feel like operating machinery.",
    "The future of computing deserves a better interface.",
    "Decentralised computing shouldn't require centralised levels of patience.",
    "Big ideas run on AO. They should be easy to access with Gleam.",
    "The permaweb is forever. Your wallet should feel right at home.",
    "The permaweb is growing up. Its wallet should too.",
    "Give me a wallet for the world being built on Arweave.",
    "A wallet is the first thing people see of a chain. It should look the part.",
    "Wallet design matters more than most people in crypto admit.",
    "The permaweb needs wallets people enjoy opening.",
    "Good wallet UX is how a chain gets its next million users.",
    "I judge a crypto project by how its wallet feels.",
    "Arweave keeps data forever. The tools around it should be built with that much care.",
    "Self custody only wins when it's easier than handing your keys to someone else.",
    "Sending tokens should feel as easy as sending a message.",
    "Tokens sitting in a wallet should be earning something.",
    "A wallet should be nice enough that you open it for fun.",
    "The next wave of AO users will pick the wallet that feels best to use.",
    "Your wallet is your login for the whole permaweb. It should feel that important.",
    "Crypto UX gets better one wallet at a time.",
    "Crypto apps should be as nice to use as the best apps on your phone.",
    "Good design is the most underrated thing in crypto.",
    "A wallet should be beautiful. I'll die on this hill.",
    "Every extra click in a wallet is a person who gives up.",
    "The wallet that feels best wins. Features come second.",
    "I want a wallet that feels calm.",
    "Crypto has plenty of smart people. It needs more good designers.",
    "People trust what looks cared for. Wallets included.",
    "Using crypto should feel as good as owning it.",
    "If my mum can't send tokens with it, the wallet isn't finished.",
    "The best crypto apps will be the ones that feel the least like crypto.",
    "Taste is a feature. Wallets need more of it.",
    "A wallet should make you feel in control the moment you open it.",
    "Small details in a wallet add up to trust.",
    "I'd switch wallets for better design alone.",
    "Clear words beat clever features in a wallet.",
    "Crypto should feel friendly the first time you open it.",
    "Design is how crypto stops feeling like a chore.",
    "Good design in crypto makes my day.",
    "Nothing beats a wallet that just works.",
    "A well designed wallet is a joy to use.",
    "Beautiful software makes crypto feel like the future.",
    "The teams that sweat the small details are the ones I want to back.",
    "When a wallet feels good, I use crypto more.",
    "Great design makes hard things feel simple. That's the whole job.",
    "A smooth send is a small joy.",
    "Good design is a form of respect for the person using it.",
    "Crypto feels different when the tools are beautiful.",
    "The permaweb is getting really nice to use.",
    "Polish is underrated. I notice it every time.",
    "Love seeing builders on Arweave care this much about design.",
    "Well made tools make me want to build.",
    "The best feeling in crypto is when everything just makes sense.",
    "Taste is spreading through the permaweb and I'm here for it.",
    "Calm, clear, beautiful. That's the wallet I want.",
    "Good wallets turn curious people into regulars.",
  ];
  var ASK_CLOSERS = [
    "Drop me an invite if you have one.",
    "Anyone with a spare Gleam seat, I'll put it to good use.",
    "Anyone have a Gleam invite to spare?",
  ];

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  document.querySelectorAll("a[data-ask-on-x]").forEach(function (link) {
    var line = pick(ASK_LINES);
    // A line that already asks for a seat needs no closer.
    var text =
      line.slice(-1) === "?" ? line : line + "\n\n" + pick(ASK_CLOSERS);
    text += "\n@gleam_wallet @aoTheComputer @ArweaveEco";
    link.href = "https://x.com/intent/post?text=" + encodeURIComponent(text);
    // The text rather than its index, so click counts stay meaningful as
    // lines are added or cut.
    link.setAttribute("data-umami-event-line", line);
  });

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
      form.querySelector("[data-friends-word]").textContent =
        friends === 1 ? "friend" : "friends";
      var balance = curve(read("ar") + read("ao"));
      var bonus = fields.invited.checked ? balance * 0.1 : 0;
      var fromFriends =
        friends * curve(read("friendAr") + read("friendAo")) * 0.1;
      var perDay = balance + bonus + fromFriends;
      form.querySelector('[data-out="day"]').textContent =
        format.format(perDay);
      form.querySelector('[data-out="month"]').textContent = format.format(
        perDay * 30,
      );
      form.querySelector('[data-out="year"]').textContent = format.format(
        perDay * 365,
      );
      // points.html draws its scoreboard from this; the text above stays for
      // screen readers and for when that script is missing
      form.gleamEstimate = {
        held: read("ar") + read("ao"),
        hold: balance,
        bonus: bonus,
        friends: fromFriends,
        perDay: perDay,
      };
      form.dispatchEvent(new window.CustomEvent("estimate"));
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
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body.success)
            throw new Error(body.message || "Send failed");
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
        status.textContent =
          "That didn't send. Check your connection and try again.";
        button.disabled = false;
      });
  });
})();
