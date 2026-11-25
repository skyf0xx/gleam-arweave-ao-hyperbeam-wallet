// The rainbow arcs.
import { COLORS, motion, program } from "./context.js";
import { flavour, pass } from "./flavours.js";

//
// Each arc draws itself left to right as it scrolls up the screen, and
// rubs itself out going back. Crossing into a colour band plays that
// band's note, so the five colours run up a scale (and back down). The
// pointer can strum it too, one string per band, and once drawn a bead of
// light runs along it now and then. The arc's x is linear in its curve
// parameter, so a band is just a fifth of the width.

var arcs = Array.prototype.slice
  .call(document.querySelectorAll(".cut-curve"))
  .map(function (cut, i) {
    var path = cut.querySelector(".arc");
    if (!path) return null;
    var n = path.getAttribute("d").match(/-?[\d.]+/g).map(Number);
    return {
      key: "arc" + i,
      cut: cut,
      draw: cut.querySelector("#arc-draw-" + (i + 1) + " rect"),
      glint: cut.querySelector("#arc-glint-" + (i + 1) + " rect"),
      // Start, control and end y of the quadratic, in viewBox units
      y: [n[1], n[3], n[5]],
      bands: -1,
      string: -1,
      nextGlint: 0,
    };
  })
  .filter(Boolean);

function arcY(arc, t) {
  var u = 1 - t;
  return u * u * arc.y[0] + 2 * u * t * arc.y[1] + t * t * arc.y[2];
}

// audible: true only for a scroll
export function updateArcs(audible) {
  var vh = window.innerHeight;
  arcs.forEach(function (arc) {
    var r = arc.cut.getBoundingClientRect();
    // Drawn from the bottom of the screen to a little over halfway up
    var p = motion ? Math.min(1, Math.max(0, (vh * 0.95 - r.top) / (vh * 0.45))) : 1;
    arc.draw.setAttribute("width", String(5 + p * 105));
    var bands = Math.min(5, Math.floor(p * 5 + 1e-6));
    if (audible && arc.bands >= 0 && bands !== arc.bands) {
      var dir = bands > arc.bands ? 1 : -1;
      var f = pass(arc.key, dir);
      // Bands crossed in one go roll, capped so a jump never turns into a run
      var crossed = [];
      for (var b = arc.bands; b !== bands; b += dir) crossed.push(dir > 0 ? b : b - 1);
      crossed.slice(-3).forEach(function (band, k) {
        program.play(f.voice, f.scale, band, k * 0.06, arc.cut);
      });
    }
    if (bands === 5 && arc.bands !== 5) arc.nextGlint = Date.now() + 2500;
    arc.bands = bands;
  });
}

export function spark(arc, t, y, band) {
  if (!motion) return;
  var dot = document.createElement("span");
  dot.className = "arc-spark";
  dot.style.left = t * 100 + "%";
  dot.style.top = y + "px";
  dot.style.setProperty("--c", COLORS[band]);
  dot.addEventListener("animationend", function () {
    dot.remove();
  });
  arc.cut.appendChild(dot);
}

// Strum: crossing into a band near the line plucks it. Leaving the line
// and coming back lets the same string ring again.
export function strum(arc, e, reach) {
  var r = arc.cut.getBoundingClientRect();
  var t = (e.clientX - r.left) / r.width;
  if (t < 0 || t > 1) return;
  var y = (arcY(arc, t) / 100) * r.height;
  var near = Math.abs(e.clientY - r.top - y) < reach;
  var band = Math.min(4, Math.floor(t * 5));
  if (!near || band >= arc.bands) {
    arc.string = -1;
    return;
  }
  if (band === arc.string && e.type !== "pointerdown") return;
  arc.string = band;
  var f = pass(arc.key + "-strum", 1);
  program.play(f.voice, f.scale, band, 0, arc.cut);
  spark(arc, t, y, band);
}

arcs.forEach(function (arc) {
  arc.cut.addEventListener("pointermove", function (e) {
    if (e.pointerType === "mouse") strum(arc, e, 26);
  });
  arc.cut.addEventListener("pointerdown", function (e) {
    strum(arc, e, 44);
  });
  arc.cut.addEventListener("pointerleave", function () {
    arc.string = -1;
  });
});

// A bead of light runs along a drawn arc every so often, chiming faintly
// as it passes each colour
var GLINT_S = 1.6;

export function glint(arc) {
  var start = null;
  function step(t) {
    if (start === null) start = t;
    var q = Math.min(1, (t - start) / (GLINT_S * 1000));
    var x = -8 + q * 112;
    arc.glint.setAttribute("x", String(x));
    arc.glint.setAttribute("width", q < 1 ? "8" : "0");
    if (q < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  var f = flavour(1);
  for (var b = 0; b < 5; b++) {
    program.play("box", f.scale, 5 + b, ((20 * b + 18) / 112) * GLINT_S, arc.cut);
  }
}

window.setInterval(function () {
  if (!motion || document.hidden) return;
  var now = Date.now();
  arcs.forEach(function (arc) {
    if (arc.bands !== 5 || now < arc.nextGlint) return;
    arc.nextGlint = now + 8000 + Math.random() * 6000;
    if (program.presence([arc.cut]) > 0.6) glint(arc);
  });
}, 1000);
