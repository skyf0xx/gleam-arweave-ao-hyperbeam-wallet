// The clock.
import { PPS, colorFor, format, motion, program, restart, root } from "./context.js";
import { announce, decEl, gc, gleamWord, mini, miniDec, miniInt, odometer, plusOne, twinkle } from "./counters.js";
import { canvas, createFx, fx, hero, rand, setFx } from "./particles.js";
import { flavour } from "./flavours.js";
import { now } from "./timeline.js";
import { sendSpark } from "./launch.js";

var ticks = Array.prototype.slice.call(
  document.querySelectorAll("[data-tick]"),
);
export var seen = {};
export var sim = 0;
export var shown = 0;
// "You earn GLEAM by" sounds on its first four points per visit, taking
// the lines in turn, then goes quiet
var TODAY_SOUNDS = 4;
var todaySounds = 0;
var todayFlavour = null;
var lastNow = null;
var raf = 0;
// A welcome-back moment. draw(e) paints over the hero's particles, e being
// the seconds since it began; rate(e) sets how fast the clock runs (negative
// runs it backwards) and hold stops it; end() runs as it finishes, with
// sim0, the clock as the moment began, there to put time right again.
export var overlay = null;
// The clock's speed from scrolling, 1 at rest
export var scrub = 1;
var lastNotch = 0;

function running() {
  if (document.hidden || root.classList.contains("gate")) return false;
  return (
    seen.hero ||
    seen.today ||
    (seen.now && now && now.classList.contains("on"))
  );
}

export function land(point) {
  var hit = colorFor(point);
  if (gc) {
    gc.style.setProperty("--hit", hit);
    gc.querySelectorAll(".od-s").forEach(function (strip, i) {
      strip.style.setProperty("--i", i);
    });
    if (motion) restart(gc, "land");
    plusOne();
  }
  // Real light catches a crystal irregularly, so GLEAM only glints on
  // some points; seeded so a replay looks the same.
  if (gleamWord && motion && rand(point * 7 + 3) < 0.45) {
    gleamWord.style.setProperty("--hit", hit);
    restart(gleamWord, "glow");
    twinkle(point);
  }
  if (mini && seen.now) {
    mini.style.setProperty("--hit", hit);
    if (motion) restart(mini, "land");
    sendSpark(point, hit);
  }
  if (seen.today) {
    ticks.forEach(function (li) {
      li.style.setProperty("--hit", hit);
      restart(li, "tick");
    });
  }
  // Loud only while a counter is on screen
  program.ping(point - 1, 0, [gc, seen.now && mini]);
  // "You earn GLEAM by" has its own voice, and only for four points: a sound
  // on every one there gets wearing. Holding's single signal is one note;
  // Inviting's two are a pair, you then your friend, a third apart.
  if (seen.today && todaySounds < TODAY_SOUNDS && program.presence(ticks) > 0.5) {
    var line = ticks[todaySounds % ticks.length];
    // One voice for the visit's four, so they read as a set
    if (!todayFlavour) todayFlavour = flavour(1);
    if (todaySounds % ticks.length === 0) {
      program.play(todayFlavour.voice, todayFlavour.scale, 0, 0, line);
    } else {
      program.play(todayFlavour.voice, todayFlavour.scale, 2, 0, line);
      program.play(todayFlavour.voice, todayFlavour.scale, 3, 0.14, line);
    }
    todaySounds++;
  }
  announce(point);
}

function frame(t) {
  raf = 0;
  if (!running()) {
    lastNow = null;
    if (fx) fx.clear();
    return;
  }
  var dt = lastNow === null ? 0 : Math.min(0.05, (t - lastNow) / 1000);
  lastNow = t;
  var e = 0;
  if (overlay) {
    if (overlay.start === null) {
      overlay.start = t;
      overlay.sim0 = sim;
    }
    e = (t - overlay.start) / 1000;
    if (e >= overlay.dur) {
      if (overlay.end) overlay.end();
      overlay = null;
    }
  }
  // A flick of the scroll pushes time; it eases back to normal by itself
  scrub = 1 + (scrub - 1) * Math.exp(-dt / 0.3);
  var rate = scrub;
  if (overlay) rate = overlay.hold ? 0 : overlay.rate ? overlay.rate(e) : 1;
  sim = Math.max(0, sim + dt * rate);
  if (gc) gc.classList.toggle("scrub", Math.abs(rate) > 2.5);
  var v = sim * PPS;
  var whole = Math.floor(v);
  if (odometer) odometer.set(whole);
  if (miniInt) miniInt.textContent = format.format(whole);
  var dec = "." + String(Math.floor((v - whole) * 100)).padStart(2, "0");
  if (decEl) decEl.textContent = dec;
  if (miniDec) miniDec.textContent = dec;
  if (whole > shown) {
    shown = whole;
    land(whole);
  } else if (whole < shown) {
    // Running backwards, each point given up sounds the note it landed on.
    // A moment scores its own rewind, so only a scroll's does this.
    if (!overlay) program.ping((shown - 1) % 10, 0, gc);
    shown = whole;
  }
  // Fast time ratchets, four clicks a point, like tape on a spool
  var notch = Math.floor(v * 4);
  if (notch !== lastNotch && Math.abs(rate) > 2.5) program.tick(0, gc);
  lastNotch = notch;
  if (fx) {
    if (seen.hero) fx.draw(sim);
    else fx.clear();
  }
  if (overlay && overlay.draw && fx && seen.hero) overlay.draw(e);
  raf = requestAnimationFrame(frame);
}

export function kick() {
  if (!raf && running()) raf = requestAnimationFrame(frame);
}

if (motion && canvas && hero) setFx(createFx());

if ("IntersectionObserver" in window) {
  var gates = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      seen[entry.target.getAttribute("data-gate")] = entry.isIntersecting;
      if (!seen.today) todayFlavour = null;
    });
    kick();
  });
  document.querySelectorAll("[data-gate]").forEach(function (el) {
    gates.observe(el);
  });
} else {
  seen.hero = seen.today = seen.now = true;
  kick();
}

document.addEventListener("visibilitychange", kick);

export function setSim(v) {
  sim = v;
}

export function setOverlay(v) {
  overlay = v;
}

export function setScrub(v) {
  scrub = v;
}
