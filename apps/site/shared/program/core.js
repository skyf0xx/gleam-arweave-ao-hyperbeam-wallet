// The beam colours, the page-wide motion flag, and the helpers every page uses.

export var root = document.documentElement;
export var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
root.classList.toggle("motion", !reducedMotion.matches);
reducedMotion.addEventListener("change", function () {
  root.classList.toggle("motion", !reducedMotion.matches);
});

export function motion() {
  return !reducedMotion.matches;
}

export var COLORS = ["#FF1717", "#8B12FF", "#73C9E8", "#FFE45C", "#28F02D"];

// Points cycle red, purple, sky, yellow, green, starting from point 1
export function colorFor(point) {
  return COLORS[(((point - 1) % 5) + 5) % 5];
}

export function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

document.addEventListener("visibilitychange", function () {
  root.classList.toggle("paused", document.hidden);
});
