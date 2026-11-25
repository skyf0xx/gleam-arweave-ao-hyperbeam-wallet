// Shows the download for this device first and the others as small links.
// `?platform=` picks one, so a link can name it. Without this script the
// page shows Chrome with iPhone and Android beside it.
(function () {
  var platforms = ["chrome", "ios", "android"];

  function detect() {
    var asked = new URLSearchParams(location.search).get("platform");
    if (platforms.indexOf(asked) !== -1) return asked;
    var ua = navigator.userAgent;
    // iPadOS reports itself as a Mac; a touch screen gives it away.
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "chrome";
  }

  function show() {
    var platform = detect();
    document.querySelectorAll(".cta[data-platform]").forEach(function (cta) {
      cta.hidden = cta.dataset.platform !== platform;
    });
    document.querySelectorAll(".links [data-platform]").forEach(function (link) {
      link.hidden = link.dataset.platform === platform;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
  else show();
})();
