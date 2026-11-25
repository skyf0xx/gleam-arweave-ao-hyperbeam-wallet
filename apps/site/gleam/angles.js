// The angled cuts.
import { motion, program } from "./context.js";
import { deckOf, pass, shuffled } from "./flavours.js";

//
// Crossing the middle of the screen strikes a cut's five lines. Each pass
// rolls how: in order (red first going down, green first going up), from
// the middle out, all at once, or scattered; how fast; and how the lines
// move as they're struck.

var STRIKES = {
  run: function (dir) {
    return dir > 0 ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
  },
  outward: function () {
    return [2, 1, 3, 0, 4];
  },
  inward: function () {
    return [0, 4, 1, 3, 2];
  },
  scatter: function () {
    return shuffled([0, 1, 2, 3, 4]);
  },
  chord: function (dir) {
    return dir > 0 ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
  },
};
var strikeShape = deckOf(Object.keys(STRIKES));
var strikeGap = deckOf([0.045, 0.07, 0.11, 0.16]);
var strikeLook = deckOf(["flare", "slide", "flash", "jolt"]);

var angles = Array.prototype.slice
  .call(document.querySelectorAll(".cut-angle"))
  .map(function (cut, i) {
    return { key: "angle" + i, cut: cut, lines: cut.querySelectorAll("line"), side: 0 };
  });

function strike(a, dir) {
  var f = pass(a.key, dir);
  var shape = strikeShape();
  var order = STRIKES[shape](dir);
  var gap = shape === "chord" ? 0.012 : strikeGap();
  order.forEach(function (line, k) {
    // The line's own colour picks its note, so red is always the root
    program.play(f.voice, f.scale, line, k * gap, a.cut);
    a.lines[line].style.animationDelay = k * gap + "s";
  });
  if (!motion) return;
  a.cut.style.setProperty("--dir", dir);
  a.cut.className = a.cut.className.replace(/\s*\bstrike-\S+/g, "");
  void a.cut.offsetWidth;
  a.cut.classList.add("strike-" + strikeLook());
}

export function updateAngles() {
  angles.forEach(function (a) {
    var r = a.cut.getBoundingClientRect();
    var side = r.top + r.height / 2 < window.innerHeight * 0.5 ? 1 : -1;
    if (a.side && side !== a.side && program.presence([a.cut]) > 0.3) strike(a, side);
    a.side = side;
  });
}
