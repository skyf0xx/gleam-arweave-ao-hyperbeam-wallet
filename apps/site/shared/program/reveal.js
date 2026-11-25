import { reducedMotion, motion } from "./core.js";

// ---- One-shot reveals: .reveal gains .in the first time it's on screen --

export function reveal(els, threshold) {
  els = Array.prototype.slice.call(els);
  if (!("IntersectionObserver" in window) || !motion()) {
    els.forEach(function (el) { el.classList.add("in"); });
    return;
  }
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
        entry.target.dispatchEvent(new window.CustomEvent("reveal"));
      }
    });
  }, { threshold: threshold || 0.35 });
  els.forEach(function (el) { observer.observe(el); });
}

reducedMotion.addEventListener("change", function () {
  if (reducedMotion.matches) {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
  }
});
