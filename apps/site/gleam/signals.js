// The earn rows, the prism and the headings that turn no chord.
import { COLORS, motion, program } from "./context.js";
import { effect, flavour, pass } from "./flavours.js";

//
// Crossing the reading line, Holding's ring pulses out on one note and
// Inviting's light runs from you to your friend on a rising pair. Going
// back up rewinds them: the ring falls inward, the light runs home, the
// notes fall.

var rows = Array.prototype.slice.call(document.querySelectorAll(".vision-today li"));

// audible: true only for a scroll
export function updateRows(audible) {
  var mark = window.innerHeight * 0.65;
  rows.forEach(function (row, i) {
    var past = row.getBoundingClientRect().top + row.offsetHeight / 2 < mark;
    var was = row.classList.contains("passed");
    row.classList.toggle("passed", past);
    if (!audible || past === was) return;
    var dir = past ? 1 : -1;
    var f = pass("rows", dir);
    var notes = i === 0 ? [0] : dir > 0 ? [2, 3] : [3, 2];
    notes.forEach(function (degree, k) {
      program.play(f.voice, f.scale, degree, k * 0.4, row);
    });
    var word = row.querySelector("strong");
    if (word) effect(word, f.fx);
    var sig = row.querySelector(".v-sig");
    if (!sig || !motion) return;
    sig.style.setProperty("--hit", COLORS[Math.floor(Math.random() * 5)]);
    sig.classList.remove("sig-fwd", "sig-back");
    void sig.offsetWidth;
    sig.classList.add(dir > 0 ? "sig-fwd" : "sig-back");
  });
}

// ---- The prism: split again on the way down, gathered back going up -----
//
// After its first reveal, the prism replays whenever it crosses the
// reading line. Down, white light enters and fans into five colours on a
// rising strum. Up, the spectrum folds back into the pane and the white
// light withdraws on a falling one, then it splits again.

export var prism = document.querySelector(".v-prism");
var prismSide = 0;
var prismBusy = 0;
var prismArmed = false;

function splitPrism(f) {
  // Snap to dark with transitions off, then let it split from there
  prism.classList.add("reset");
  prism.classList.remove("in");
  void prism.getBoundingClientRect();
  prism.classList.remove("reset");
  void prism.getBoundingClientRect();
  prism.classList.add("in");
  program.soft(0, 0.1, prism);
  [0, 1, 2, 3, 4].forEach(function (degree, i) {
    program.play(f.voice, f.scale, degree, 0.72 + i * 0.05, prism);
  });
}

export function updatePrism() {
  if (!prism) return;
  var r = prism.getBoundingClientRect();
  var side = r.top + r.height / 2 < window.innerHeight * 0.6 ? 1 : -1;
  var crossed = prismSide && side !== prismSide;
  prismSide = side;
  if (!crossed || !motion || !prism.classList.contains("in") || Date.now() < prismBusy) return;
  // The first crossing is the reveal's own; replays start after it
  if (!prismArmed) {
    prismArmed = true;
    return;
  }
  if (side > 0) {
    prismBusy = Date.now() + 1700;
    splitPrism(pass("prism", 1));
    return;
  }
  prismBusy = Date.now() + 3000;
  var f = pass("prism", -1);
  prism.classList.add("gather");
  prism.classList.remove("in");
  [4, 3, 2, 1, 0].forEach(function (degree, i) {
    program.play(f.voice, f.scale, degree, i * 0.06, prism);
  });
  program.sweep(4, 0, 0.6, 0.45, prism);
  window.setTimeout(function () {
    prism.classList.remove("gather");
    splitPrism(flavour(1));
  }, 1300);
}

// ---- Headings that turn no chord: stake, and the closing line ------------

var stakeHead = document.querySelector(".v-stake-h");
var stakeSide = 0;

export function updateStakeHead() {
  if (!stakeHead) return;
  var r = stakeHead.getBoundingClientRect();
  var side = r.top + r.height / 2 < window.innerHeight * 0.65 ? 1 : -1;
  if (stakeSide && side !== stakeSide) {
    var f = pass("stake-h", side);
    (side > 0 ? [2, 5] : [5, 2]).forEach(function (degree, k) {
      program.play(f.voice, f.scale, degree, k * 0.18, stakeHead);
    });
    effect(stakeHead, f.fx);
  }
  stakeSide = side;
}
