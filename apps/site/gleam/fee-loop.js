// The fee share loop.
import { motion, program } from "./context.js";
import { forwardVoice, pass } from "./flavours.js";

//
// As the value passes Use, Fees and Stakers, each stop lights in its
// colour and sounds a note: Fees and Stakers climb the chord and Use, the
// loop closing, comes in an octave up. Each lap takes a new voice. It
// plays two laps each time the card comes into view, then just turns.
// Scrolling up with it on screen runs the loop backwards, notes falling
// to the low root, until the scroll stops.

var loopArt = document.querySelector(".art-loop");
var LOOP_MS = 10000;
var LOOP_NOTES = 6;
var loopCard = loopArt && loopArt.closest(".perk");
var orbit = loopArt && loopArt.querySelector(".l-orbit");
var loopNodes = loopArt ? loopArt.querySelectorAll(".l-node") : [];
var loopState = { left: 0, seg: null, raf: 0, on: false, voice: null, back: 0 };

function orbitAnimation() {
  var all = orbit && orbit.getAnimations ? orbit.getAnimations() : [];
  return all[0] || null;
}

function loopStop(station, dir) {
  var node = loopNodes[station];
  if (node && motion) {
    node.classList.remove("hit");
    void node.getBoundingClientRect();
    node.classList.add("hit");
  }
  if (dir > 0) {
    if (!loopState.voice) loopState.voice = forwardVoice();
    if (loopState.left > 0) {
      loopState.left--;
      program.play(loopState.voice, "pentatonic", [5, 2, 3][station], 0, loopArt);
    }
    // The lap closes on Use in its own voice; the next lap takes a new one
    if (station === 0) loopState.voice = forwardVoice();
  } else {
    program.play(pass("loop", -1).voice, "pentatonic", [0, 2, 3][station], 0, loopArt);
  }
}

function loopFrame() {
  loopState.raf = 0;
  if (!loopState.on) return;
  var a = orbitAnimation();
  if (a && a.currentTime !== null) {
    var t = ((a.currentTime % LOOP_MS) + LOOP_MS) % LOOP_MS;
    var seg = Math.floor(t / (LOOP_MS / 3));
    if (loopState.seg !== null && seg !== loopState.seg) {
      var dir = a.playbackRate < 0 ? -1 : 1;
      // Going forward the dot has reached the stop that begins this third;
      // going back it has passed the one that began the last
      loopStop(dir > 0 ? seg : loopState.seg, dir);
    }
    loopState.seg = seg;
  }
  loopState.raf = requestAnimationFrame(loopFrame);
}

export function reverseLoop() {
  var a = loopState.on && orbitAnimation();
  if (!a) return;
  if (a.updatePlaybackRate) a.updatePlaybackRate(-1);
  else a.playbackRate = -1;
  window.clearTimeout(loopState.back);
  loopState.back = window.setTimeout(function () {
    if (a.updatePlaybackRate) a.updatePlaybackRate(1);
    else a.playbackRate = 1;
  }, 350);
}

if (loopCard && "IntersectionObserver" in window) {
  new IntersectionObserver(
    function (entries) {
      var entry = entries[entries.length - 1];
      if (entry.isIntersecting && !loopState.on) {
        loopState.on = true;
        loopState.left = LOOP_NOTES;
        loopState.seg = null;
        if (!loopState.raf) loopState.raf = requestAnimationFrame(loopFrame);
      } else if (!entry.isIntersecting) {
        loopState.on = false;
      }
    },
    { threshold: 0.5 },
  ).observe(loopCard);
}
