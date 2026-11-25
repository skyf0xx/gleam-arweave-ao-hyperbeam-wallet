// The wallet section: its sentences and its three ways in.
import { COLORS, program } from "./context.js";
import { effect, pass } from "./flavours.js";

var lines = Array.prototype.slice.call(
  document.querySelectorAll("[data-lines] > span"),
);

// audible: true only for a scroll. Each sentence lighting on the way down
// sounds a note, the second higher than the first; going back up plays
// them out backwards. Each pass picks its own voice and scale.
export function updateLines(audible) {
  var mark = window.innerHeight * 0.72;
  lines.forEach(function (span, i) {
    var lit = span.getBoundingClientRect().top < mark;
    if (audible && lit !== span.classList.contains("lit")) {
      var f = pass("lines", lit ? 1 : -1);
      program.play(f.voice, f.scale, [2, 5][i % 2], 0, span);
      span.style.setProperty("--c", COLORS[Math.floor(Math.random() * 5)]);
      effect(span, f.fx);
    }
    span.classList.toggle("lit", lit);
  });
}

// ---- The wallet's three ways in: underlined, one after another ----------
//
// As the sentence crosses the reading line, each choice's underline draws
// in with its note: hardware wallet, existing key, new wallet. Going back
// up they run out in reverse. Pointing at one plays it.

var choices = Array.prototype.slice.call(document.querySelectorAll(".v-sub b"));
var CHOICE_DEGREES = [0, 2, 4];

// audible: true only for a scroll
export function updateChoices(audible) {
  var mark = window.innerHeight * 0.72;
  var changed = [];
  choices.forEach(function (b, i) {
    var lit = b.getBoundingClientRect().top < mark;
    if (lit !== b.classList.contains("lit")) changed.push(i);
  });
  if (!changed.length) return;
  var dir = choices[changed[0]].classList.contains("lit") ? -1 : 1;
  if (dir < 0) changed.reverse();
  var f = audible ? pass("choices", dir) : null;
  changed.forEach(function (i, k) {
    var b = choices[i];
    var delay = audible ? k * 0.16 : 0;
    b.style.transitionDelay = delay + "s";
    b.classList.toggle("back", dir < 0);
    b.classList.toggle("lit", dir > 0);
    if (!f) return;
    program.play(f.voice, f.scale, CHOICE_DEGREES[i], delay, b);
    b.style.animationDelay = delay + "s";
    effect(b, f.fx);
  });
}

choices.forEach(function (b, i) {
  b.addEventListener("pointerenter", function (e) {
    if (e.pointerType !== "mouse") return;
    var f = pass("choices-hover", 1);
    program.play(f.voice, f.scale, CHOICE_DEGREES[i], 0, b);
    b.style.animationDelay = "0s";
    effect(b, "ring");
  });
});
