(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Reveal each section once, the first time it enters the viewport.
  var sections = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reducedMotion.matches) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });
    sections.forEach(function (section) { observer.observe(section); });
  } else {
    sections.forEach(function (section) { section.classList.add("in"); });
  }

  // Glint: every 12–20s, one visible showcase render catches the light.
  var glintTargets = Array.prototype.slice.call(document.querySelectorAll(".showcase .float"));
  var visible = new Set();
  var glintTimer = null;

  if ("IntersectionObserver" in window) {
    var visibility = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
    }, { threshold: 0.5 });
    glintTargets.forEach(function (el) { visibility.observe(el); });
  }

  function scheduleGlint() {
    clearTimeout(glintTimer);
    if (reducedMotion.matches || document.hidden) return;
    glintTimer = setTimeout(function () {
      var candidates = Array.from(visible);
      if (candidates.length) {
        var el = candidates[Math.floor(Math.random() * candidates.length)];
        el.classList.remove("glint");
        void el.offsetWidth;
        el.classList.add("glint");
        el.addEventListener("animationend", function () { el.classList.remove("glint"); }, { once: true });
      }
      scheduleGlint();
    }, 12000 + Math.random() * 8000);
  }

  // Refraction line: follows the cursor by up to ±6px, eased.
  var line = document.querySelector(".refraction");
  var finePointer = window.matchMedia("(pointer: fine)");
  var target = { x: 0, y: 0 };
  var current = { x: 0, y: 0 };
  var frame = null;

  function step() {
    current.x += (target.x - current.x) * 0.06;
    current.y += (target.y - current.y) * 0.06;
    line.style.setProperty("--rx", current.x.toFixed(2) + "px");
    line.style.setProperty("--ry", current.y.toFixed(2) + "px");
    if (Math.abs(target.x - current.x) > 0.01 || Math.abs(target.y - current.y) > 0.01) {
      frame = requestAnimationFrame(step);
    } else {
      frame = null;
    }
  }

  function onPointerMove(event) {
    if (reducedMotion.matches || document.hidden) return;
    target.x = (event.clientX / window.innerWidth - 0.5) * 12;
    target.y = (event.clientY / window.innerHeight - 0.5) * 12;
    if (frame === null) frame = requestAnimationFrame(step);
  }

  if (line && finePointer.matches) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
  }

  document.addEventListener("visibilitychange", function () {
    root.classList.toggle("paused", document.hidden);
    if (document.hidden) {
      clearTimeout(glintTimer);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    } else {
      scheduleGlint();
    }
  });

  reducedMotion.addEventListener("change", function () {
    if (reducedMotion.matches) {
      clearTimeout(glintTimer);
      target.x = target.y = current.x = current.y = 0;
      if (line) {
        line.style.removeProperty("--rx");
        line.style.removeProperty("--ry");
      }
    } else {
      scheduleGlint();
    }
  });

  scheduleGlint();
})();
