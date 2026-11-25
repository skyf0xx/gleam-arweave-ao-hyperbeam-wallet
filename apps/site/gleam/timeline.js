// The timeline: page scroll drives history sideways.
import { COLORS, motion, program } from "./context.js";
import { effect, pass } from "./flavours.js";
import { arrive, launchGleam } from "./launch.js";
import { kick } from "./clock.js";

export var tl = document.querySelector("[data-tl]");
var tlViewport = tl && tl.querySelector(".tl-viewport");
var track = tl && tl.querySelector(".tl-track");
var tlItems = tl
  ? Array.prototype.slice.call(tl.querySelectorAll(".tl-item"))
  : [];
export var now = tl && tl.querySelector(".tl-now");
export var launch = tl && tl.querySelector(".tl-next");
export var launchBeam = launch && launch.querySelector(".tl-launch-beam");
export var launchLetters = [];
export var launched = false;
// The dashes are fully drawn, so a spark has a line to ride
export var launchOpen = false;
var tlGeo = { nowX: 0, range: 0, hold: 0, pan: 0, panTravel: 0 };
export var tlFrame = null;

export function layoutTimeline() {
  if (!tl) return;
  tlGeo.nowX = now.offsetLeft;
  tlItems.forEach(function (li) {
    li._x = li.offsetLeft;
  });
  track.style.setProperty("--now-x", tlGeo.nowX + "px");
  if (!motion) {
    tl.style.height = "";
    track.style.transform = "";
    track.style.removeProperty("--next");
    track.style.setProperty("--fill", tlGeo.nowX + "px");
    tlItems.forEach(function (li) {
      li.classList.add("lit");
    });
    now.classList.add("on");
    if (launch) launch.classList.add("launched");
    tlViewport.scrollLeft = tlViewport.scrollWidth;
    return;
  }
  var vw = tlViewport.clientWidth;
  // The camera follows the beam's head mid-screen, then eases it left on
  // arrival so "Next" fits on the marker's right
  tlGeo.panTravel = vw * 0.55;
  tlGeo.pan = vw * (vw < 600 ? 0.18 : 0.3);
  tlGeo.range = tlGeo.nowX * 0.85;
  // Extra pinned scroll after arrival: the launch line draws in and stays
  // readable before the section lets go
  tlGeo.hold = window.innerHeight * 0.9;
  tl.style.height = window.innerHeight + tlGeo.range + tlGeo.hold + "px";
  updateTimeline();
}

// audible: true only for a scroll, so a layout pass never chimes
export function updateTimeline(audible) {
  tlFrame = null;
  if (!motion) return;
  var top = tl.getBoundingClientRect().top;
  var p = Math.min(1, Math.max(0, -top / tlGeo.range));
  var next = Math.min(1, Math.max(0, (-top - tlGeo.range) / (tlGeo.hold * 0.4)));
  track.style.setProperty("--next", next.toFixed(3));
  var head = p * tlGeo.nowX;
  var settle = Math.min(1, Math.max(0, (p - 0.82) / 0.18));
  settle = settle * settle * (3 - 2 * settle);
  var pan = tlGeo.panTravel + (tlGeo.pan - tlGeo.panTravel) * settle;
  var shift = Math.max(0, head - pan);
  track.style.transform = "translate3d(" + -shift + "px,0,0)";
  track.style.setProperty("--fill", head.toFixed(1) + "px");
  // Each milestone the beam reaches rings one step higher, so history
  // climbs a scale, and rewinding through it walks back down. Each pass
  // plays in its own voice and scale with its own effect. A fast scroll
  // changing several at once rolls them, capped so it never turns into a run.
  var rung = 0;
  tlItems.forEach(function (li, i) {
    var lit = li._x <= head + 1;
    if (audible && lit !== li.classList.contains("lit") && rung < 3) {
      var f = pass("tl", lit ? 1 : -1);
      program.play(f.voice, f.scale, i, rung * 0.07, li.querySelector(".tl-card") || li);
      li.style.setProperty("--c", COLORS[i % 5]);
      effect(li, f.fx);
      rung++;
    }
    li.classList.toggle("lit", lit);
  });
  var on = p >= 0.995;
  if (on !== now.classList.contains("on")) {
    now.classList.toggle("on", on);
    // Arriving at "You are here" lands on a chord, an octave over where
    // the timeline's scale began, voiced and rolled its own way each time.
    // Backing off the present rewinds it in one falling sweep.
    var dot = now.querySelector(".tl-now-dot") || now;
    if (on && audible) arrive(dot);
    if (!on && audible) program.sweep(8, 0, 0.7, 0, dot);
    kick();
  }
  launchOpen = next >= 0.999;
  if (launchOpen && !launched) launchGleam(audible);
}

export function setTlFrame(v) {
  tlFrame = v;
}

export function setLaunched(v) {
  launched = v;
}
