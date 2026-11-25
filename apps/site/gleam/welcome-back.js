// Welcome back: a different moment each time the hero comes round.
import { COLORS, motion, program, restart, root } from "./context.js";
import { gc, gleamWord } from "./counters.js";
import { fx, hero, rand } from "./particles.js";
import { deckOf } from "./flavours.js";
import { kick, setOverlay, setSim, sim } from "./clock.js";

//
// Once the gate is behind them, a visitor who scrolls back up to the hero
// after a few seconds away gets one short moment drawn from a shuffled
// deck, so none repeats until all have played.

function ease(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

export function spread() {
  return Math.max(120, Math.abs(fx.g.ty - fx.g.by) * 1.4);
}

// A beam pulse: a stripe's colour trailing to nothing behind its head
function streak(s, hx, dir, alpha) {
  var ctx = fx.ctx;
  var y = fx.stripeY(s);
  var grad = ctx.createLinearGradient(hx - 180 * dir, 0, hx, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, COLORS[s]);
  fx.line(hx - 180 * dir, y, hx, y, grad, 2.4, alpha);
}

// Slow to a stop, then run backwards: the clock really reverses, so the
// shards leave the counter for the beam and the count rolls down
function slowThenBack(e) {
  if (e < 0.2) return 1 - e * 5;
  return e < 1.3 ? -12 : 0;
}

// Rewind, then snap back to the right time with a bright ping
function rewind() {
  setOverlay({
    start: null,
    dur: 1.6,
    rate: slowThenBack,
    end: function () {
      setSim(this.sim0 + this.dur);
      if (gc) restart(gc, "burst");
      program.ping(10, 0, gc);
      program.ping(5, 0.04, gc);
    },
  });
  program.sweep(9, 0, 1.05, 0.2, gc);
}

// Rewind, a beat's pause, then fast-forward back to the right time
function rewindCatchUp() {
  setOverlay({
    start: null,
    dur: 2.9,
    rate: function (e) {
      if (e < 1.6) return slowThenBack(e);
      // Fast enough to arrive back at the true time just as it ends
      var behind = this.sim0 + e - sim;
      return Math.max(1, behind / Math.max(0.05, this.dur - e));
    },
    end: function () {
      setSim(this.sim0 + this.dur);
      program.ping(10, 0, gc);
    },
  });
  program.sweep(9, 0, 1.05, 0.2, gc);
  program.sweep(0, 10, 1.2, 1.65, gc);
}

// Time spins up to 8x, the count races, then it eases back to normal
function fastForward() {
  setOverlay({
    start: null,
    dur: 1.9,
    rate: function (e) {
      var up = e < 0.3 ? ease(e / 0.3) : e < 1.2 ? 1 : 1 - ease((e - 1.2) / 0.7);
      return 1 + 7 * up;
    },
  });
  program.sweep(0, 10, 1.3, 0.05, gc);
}

// The beam is struck like a string: its stripes shake, a little out of
// step, and settle under one low note
export function pluck() {
  var beam = document.querySelector(".v-beam");
  if (beam) restart(beam, "pluck");
  program.soft(0, 0, gc);
}

// One pulse per colour, all at once, each scattering into its own shards
// and landing together on a chord
function fiveAtOnce() {
  setOverlay({
    start: null,
    dur: 1.9,
    hold: false,
    draw: function (e) {
      var sp = spread();
      for (var s = 0; s < 5; s++) {
        var a = (e - s * 0.05) / 0.7;
        if (a > 0 && a < 1) streak(s, fx.g.bx * ease(a), 1, 1);
        var b = (e - 0.75 - s * 0.05) / 0.9;
        if (b <= 0 || b >= 1) continue;
        for (var i = 0; i < 6; i++) {
          var t = Math.min(1, b * (1 + rand(i * 7 + s) * 0.3));
          if (t < 1) fx.flight((40 + i) * 5 + s, t, sp, 1.8, 1 - t * t);
        }
      }
      fx.ctx.globalAlpha = 1;
    },
  });
  program.soft(0, 0.1, gc);
  [0, 2, 3, 5].forEach(function (step, i) {
    program.ping(step, 1.6 + i * 0.03, gc);
  });
  window.setTimeout(function () {
    if (gc) restart(gc, "burst");
  }, 1600);
}

// GLEAM in the headline lights letter by letter, each in its beam colour,
// climbing the scale
function cascade() {
  if (!gleamWord) return;
  var over = document.createElement("span");
  over.className = "v-cascade";
  over.setAttribute("aria-hidden", "true");
  "GLEAM".split("").forEach(function (ch, i) {
    var letter = document.createElement("i");
    letter.textContent = ch;
    letter.style.setProperty("--c", COLORS[i]);
    letter.style.animationDelay = i * 0.09 + "s";
    over.appendChild(letter);
  });
  over.lastChild.addEventListener("animationend", function () {
    over.remove();
  });
  gleamWord.appendChild(over);
  [0, 1, 2, 3, 4].forEach(function (step, i) {
    program.ping(step, 0.05 + i * 0.09, gleamWord);
  });
  program.ping(5, 0.6, gleamWord);
}

// The counter's digits spin a full turn, like a slot machine, and land back
// on the right number
function spin() {
  if (!gc) return;
  var strips = gc.querySelectorAll(".od-s");
  strips.forEach(function (strip, i) {
    var d = Number(strip.dataset.at || 0) % 10;
    strip.style.setProperty("--a", d - 10 + "em");
    strip.style.setProperty("--b", d + "em");
    strip.style.setProperty("--i", i);
  });
  restart(gc, "spin");
  for (var k = 0; k < 9; k++) program.tick(k * 0.07 + k * k * 0.004, gc);
  program.ping(5, 0.95 + strips.length * 0.06, gc);
}

// The particles stop where they are while six motes fly out and draw the
// Gleam hexagon in thin coloured lines, then let it go
function constellation() {
  setOverlay({
    start: null,
    dur: 2.6,
    hold: true,
    draw: function (e) {
      var g = fx.g;
      var ctx = fx.ctx;
      var r = Math.min(90, Math.max(40, Math.min(g.w, g.h) * 0.09));
      var cx = Math.min(g.w - r - 16, Math.max(r + 16, g.tx));
      var cy = Math.max(r + 16, g.ty - g.th * 0.9 - r);
      var fade = 1 - ease((e - 2.1) / 0.5);
      var pts = [];
      for (var k = 0; k < 6; k++) {
        pts.push([cx + r * Math.sin((k * Math.PI) / 3), cy - r * Math.cos((k * Math.PI) / 3)]);
      }
      for (k = 0; k < 6; k++) {
        var m = ease((e - k * 0.07) / 0.7);
        if (m <= 0) continue;
        var x0 = g.bx;
        var y0 = fx.stripeY(k % 5);
        var x = x0 + (pts[k][0] - x0) * m;
        var y = y0 + (pts[k][1] - y0) * m;
        ctx.globalAlpha = fade;
        ctx.fillStyle = COLORS[k % 5];
        ctx.beginPath();
        ctx.arc(x, y, m < 1 ? 2.5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        var d = ease((e - 0.75 - k * 0.12) / 0.3);
        if (d <= 0) continue;
        var a = pts[k];
        var b = pts[(k + 1) % 6];
        var ex = a[0] + (b[0] - a[0]) * d;
        var ey = a[1] + (b[1] - a[1]) * d;
        fx.line(a[0], a[1], ex, ey, COLORS[k % 5], 10, 0.2 * fade);
        fx.line(a[0], a[1], ex, ey, COLORS[k % 5], 2.5, fade);
      }
      ctx.globalAlpha = 1;
    },
  });
  for (var k = 0; k < 6; k++) program.ping(k, 0.75 + k * 0.12 + 0.15, gc);
  [0, 2, 3].forEach(function (step) {
    program.soft(step, 1.6, gc);
  });
}

// Stars open all over the headline, each at its own high pitch, like
// light catching a stone as it turns
function glintStorm() {
  var title = document.querySelector(".v-title");
  if (!title) return;
  var seed = Date.now();
  for (var i = 0; i < 9; i++) {
    var star = document.createElement("span");
    star.className = "v-twinkle";
    star.setAttribute("aria-hidden", "true");
    star.style.setProperty("--hit", COLORS[i % 5]);
    star.style.left = 3 + rand(seed + i * 3) * 92 + "%";
    star.style.top = 8 + rand(seed + i * 5) * 80 + "%";
    star.style.fontSize = 1 + rand(seed + i * 7) * 0.8 + "em";
    star.style.animationDelay = i * 0.1 + "s";
    star.addEventListener("animationend", function (ev) {
      ev.currentTarget.remove();
    });
    title.appendChild(star);
    if (i % 3 !== 2) program.ping(5 + Math.floor(rand(seed + i) * 5), 0.4 + i * 0.1, title);
  }
}

var MOMENTS = [
  rewind,
  rewindCatchUp,
  fastForward,
  pluck,
  fiveAtOnce,
  cascade,
  spin,
  constellation,
  glintStorm,
];
var nextMoment = deckOf(MOMENTS);
var quietUntil = 0;
var returns = 0;

// The fifth return of a visit, once ever, gets a line instead of a moment
function echo() {
  var meter = document.querySelector(".v-meter");
  if (!meter) return false;
  try {
    if (localStorage.getItem("gleam:echo")) return false;
    localStorage.setItem("gleam:echo", "1");
  } catch {
    return false;
  }
  var line = document.createElement("p");
  line.className = "v-echo";
  line.textContent = "You keep coming back. Your AO should too.";
  line.addEventListener("animationend", function (ev) {
    if (ev.animationName === "echo") line.remove();
  });
  meter.appendChild(line);
  [0, 2, 3, 5].forEach(function (step, i) {
    program.soft(step, i * 0.12, gc);
  });
  return true;
}

function welcomeBack() {
  if (Date.now() < quietUntil || root.classList.contains("gate")) return;
  quietUntil = Date.now() + 3000;
  returns++;
  if (returns === 5 && echo()) return;
  if (!motion || !fx) {
    program.soft(0, 0, gc);
    program.soft(3, 0.12, gc);
    return;
  }
  nextMoment()();
  kick();
}

if (hero && "IntersectionObserver" in window) {
  var away = null;
  new IntersectionObserver(
    function (entries) {
      var entry = entries[entries.length - 1];
      if (root.classList.contains("gate")) return;
      if (!entry.isIntersecting) {
        if (away === null) away = Date.now();
        return;
      }
      if (entry.intersectionRatio < 0.5 || away === null) return;
      var gone = Date.now() - away;
      away = null;
      if (gone >= 3000) welcomeBack();
    },
    { threshold: [0, 0.5] },
  ).observe(hero);
}
