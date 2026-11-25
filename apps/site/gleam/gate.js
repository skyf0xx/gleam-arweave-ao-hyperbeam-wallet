// The gate, and the page-level scroll and resize wiring.
import { COLORS, motion, program, reducedMotion, restart, root, setMotion } from "./context.js";
import { gc } from "./counters.js";
import { canvas, createFx, fx, hero, setFx } from "./particles.js";
import { layoutTimeline } from "./timeline.js";
import { requestTimeline } from "./launch.js";
import { updateChoices, updateLines } from "./wallet.js";
import { updatePrism, updateRows, updateStakeHead } from "./signals.js";
import { updateConvert } from "./convert.js";
import { updateArcs } from "./arcs.js";
import { trackScroll } from "./scroll-air.js";
import { updateAngles } from "./angles.js";
import { updateSteps } from "./tokenomics.js";
import { reveals } from "./reveals.js";
import { kick, overlay, scrub, seen, setScrub } from "./clock.js";

export var gate = document.querySelector(".v-gate");
if (gate && root.classList.contains("gate")) holdGate();

function holdGate() {
  var orb = gate.querySelector(".v-gate-orb");
  var behind = Array.prototype.slice.call(
    document.querySelectorAll("main > :not(.v-hero), .site-footer"),
  );
  behind.forEach(function (el) {
    el.inert = true;
  });
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  // The orb leans a little toward the pointer, as if it's watching. 10px
  // at the screen's edge, matching the CSS.
  var lx = 0;
  var ly = 0;
  function lean(e) {
    var r = gate.getBoundingClientRect();
    lx = (e.clientX - r.left) / r.width - 0.5;
    ly = (e.clientY - r.top) / r.height - 0.5;
    orb.style.setProperty("--lx", lx.toFixed(3));
    orb.style.setProperty("--ly", ly.toFixed(3));
  }

  // Three taps charge the orb, a third of its ring each, and each puts one
  // thing GLEAM gets you under it. The third overcharges it and wakes the
  // hero. The first tap is also what unlocks the page's sound.
  var line = gate.querySelector(".v-gate-line");
  var shock = gate.querySelector(".v-gate-shock");
  var segs = gate.querySelectorAll(".v-gate-charge .fill");
  var live = document.querySelector("[data-gate-live]");
  var perks = Array.prototype.slice.call(
    gate.querySelector(".v-perks").content.children,
  );
  var charge = 0;
  var flash = document.querySelector(".v-gate-flash");
  var sparks = document.querySelector(".v-gate-sparks");
  var pen = sparks && sparks.getContext("2d");
  var flying = [];
  var sparking = 0;

  // Sparks thrown off the orb's edge, streaking out and slowing as they
  // burn down. power scales how far they fly.
  function burst(count, power, colors) {
    if (!pen) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var area = sparks.getBoundingClientRect();
    if (sparks.width !== Math.round(area.width * dpr)) {
      sparks.width = Math.round(area.width * dpr);
      sparks.height = Math.round(area.height * dpr);
    }
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    var o = orb.getBoundingClientRect();
    var cx = o.left + o.width / 2 - area.left;
    var cy = o.top + o.height / 2 - area.top;
    var r = o.width / 2;
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = (6 + Math.random() * 16) * power;
      flying.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 1,
        fade: 0.012 + Math.random() * 0.025,
        width: 1.5 + Math.random() * 2.5,
        color: Math.random() < 0.25 ? "#fff" : colors[i % colors.length],
      });
    }
    if (!sparking) sparking = requestAnimationFrame(fly);
  }

  function fly() {
    var w = sparks.width;
    var h = sparks.height;
    pen.save();
    pen.setTransform(1, 0, 0, 1, 0, 0);
    pen.clearRect(0, 0, w, h);
    pen.restore();
    pen.globalCompositeOperation = "lighter";
    pen.lineCap = "round";
    flying = flying.filter(function (p) {
      var x = p.x;
      var y = p.y;
      p.vx *= 0.92;
      p.vy = p.vy * 0.92 + 0.12;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.fade;
      if (p.life <= 0) return false;
      pen.globalAlpha = p.life;
      pen.strokeStyle = p.color;
      pen.lineWidth = p.width * p.life;
      pen.beginPath();
      pen.moveTo(x - p.vx * 1.5, y - p.vy * 1.5);
      pen.lineTo(p.x, p.y);
      pen.stroke();
      return true;
    });
    sparking = flying.length ? requestAnimationFrame(fly) : 0;
  }

  function pull() {
    if (root.classList.contains("waking") || charge >= perks.length) return;
    var n = charge++;
    var c = COLORS[n * 2];
    var last = n === perks.length - 1;
    if (window.umami) window.umami.track("gleam-gate-" + charge);

    gate.classList.add("charging");
    gate.style.setProperty("--level", String(charge));
    gate.style.setProperty("--c", c);
    if (flash) flash.style.setProperty("--c", c);
    segs[n].classList.add("on");
    line.replaceChildren(perks[n].cloneNode(true));
    if (live) live.textContent = line.textContent;
    if (motion) {
      restart(orb, "hit");
      restart(shock, "go");
      restart(line, "slam");
      restart(gate, "shake");
      restart(flash, "go");
      burst(40 + n * 45, 1 + n * 0.5, [c]);
    }
    if (last) gate.classList.add("full");
    if (navigator.vibrate) navigator.vibrate(last ? [30, 40, 60] : 25 + n * 10);

    if (n === 0) program.enableSound(function () { hitSound(n); });
    else hitSound(n);
    if (last) window.setTimeout(wake, motion ? 2400 : 2700);
  }

  // A thump and a struck chord, each a step up the scale from the last
  function hitSound(n) {
    program.loud(function () {
      program.thump(0, 1 + n);
      [0, 2, 4].forEach(function (k, i) {
        program.ping(n * 2 + k, i * 0.025);
      });
      program.soft(n * 2, 0);
      program.boom(0, 0.6 + n * 0.5);
    }, 0.5);
  }

  // The nav stays usable, so only Enter or Space with nothing else focused
  function onKey(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (document.activeElement && document.activeElement !== document.body &&
        document.activeElement !== gate) return;
    e.preventDefault();
    pull();
  }

  gate.addEventListener("pointermove", lean);
  gate.addEventListener("click", pull);
  document.addEventListener("keydown", onKey);

  function wake() {
    if (root.classList.contains("waking")) return;
    gate.removeEventListener("pointermove", lean);
    document.removeEventListener("keydown", onKey);

    // Fly the orb so its 0 lands on the counter's 0. The orb scales about
    // its own centre, so the 0's offset from that centre scales with it.
    var box = orb.getBoundingClientRect();
    var zero = gate.querySelector(".v-gate-num b").getBoundingClientRect();
    var to = document.querySelector(".gc-num").getBoundingClientRect();
    var k = to.height / zero.height;
    var cx = box.left + box.width / 2 - lx * 10;
    var cy = box.top + box.height / 2 - ly * 10;
    var zx = zero.left + zero.width / 2 - lx * 10;
    var zy = zero.top + zero.height / 2 - ly * 10;
    root.classList.add("waking");
    if (motion) {
      gate.classList.remove("full");
      restart(gate, "blast");
      restart(flash, "white");
      burst(260, 2.2, COLORS);
      orb.style.translate =
        to.left + to.width / 2 - cx - k * (zx - cx) + "px " +
        (to.top + to.height / 2 - cy - k * (zy - cy)) + "px";
      orb.style.scale = String(k);
    }

    // The rings burst up the scale as the orb lets go, then a second hit as
    // it lands and the count begins
    program.enableSound(function () {
      program.loud(function () {
        program.thump(0, 4);
        program.boom(0, 2.6);
        program.soft(0, 0);
        [0, 1, 2, 3, 4].forEach(function (step, i) {
          program.ping(step, i * 0.06);
        });
        program.thump(0.95, 2);
        program.ping(5, 0.95);
      }, 0.5);
    });

    window.setTimeout(function () {
      root.classList.remove("gate", "waking");
      behind.forEach(function (el) {
        el.inert = false;
      });
      if (gate.contains(document.activeElement)) document.activeElement.blur();
      if (fx) fx.measure();
      if (gc && motion) restart(gc, "land");
      kick();
    }, motion ? 1300 : 300);
  }
}

// Scrolling in the hero drives its clock: a brisk scroll up runs time
// backwards, down runs it forwards and fast. A slow scroll barely moves it.
var lastScroll = { y: window.scrollY, t: 0 };

function scrubTime() {
  var t = window.performance.now();
  var dt = t - lastScroll.t;
  var dy = window.scrollY - lastScroll.y;
  lastScroll = { y: window.scrollY, t: t };
  if (!motion || !seen.hero || overlay || root.classList.contains("gate")) return;
  if (dt <= 0 || dt > 250) return;
  // px/ms: 2 is a brisk flick, worth 10x either way
  var target = Math.max(-10, Math.min(10, 1 + (5 * dy) / dt));
  setScrub(scrub * 0.5 + target * 0.5);
  kick();
}

function onScroll() {
  trackScroll();
  updateAngles();
  requestTimeline();
  updateLines(true);
  updateRows(true);
  updatePrism();
  updateStakeHead();
  updateSteps(true);
  updateConvert();
  updateChoices(true);
  updateArcs(true);
  scrubTime();
}

function onResize() {
  if (fx) fx.measure();
  layoutTimeline();
  updateLines();
  updateRows();
  updateChoices();
  updateSteps();
  updateArcs();
}

window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onResize);
if (document.fonts && document.fonts.ready)
  document.fonts.ready.then(onResize);
layoutTimeline();
updateLines();
updateRows();
updateChoices();
updateArcs();

// Switching reduced motion mid-visit swaps every motion path at once
reducedMotion.addEventListener("change", function () {
  setMotion(!reducedMotion.matches);
  if (motion && canvas && hero && !fx) setFx(createFx());
  if (!motion && fx) {
    fx.clear();
    setFx(null);
  }
  reveals.forEach(function (el) {
    el.classList.add("in");
  });
  onResize();
});
