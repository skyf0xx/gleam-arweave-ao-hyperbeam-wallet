// Shared by welcome.html, feedback.html and goodbye.html, the pages the
// extension opens. The extension passes only its version (?v=), never
// anything about the user or their wallet.
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var version = (params.get("v") || "").slice(0, 32);

  // Only count a visit the extension opened (it always passes ?v=), so
  // someone landing here from a search or a shared link isn't an install.
  // sessionStorage stops a reload from counting twice.
  var event = document.body.getAttribute("data-event");
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
