// One-shot reveals, their sounds and the closing chord.
import { COLORS, motion, program, restart } from "./context.js";
import { hero } from "./particles.js";
import { deckOf, effect, flavour } from "./flavours.js";
import { scrollDir } from "./scroll-air.js";

export var reveals = document.querySelectorAll(".reveal");
program.reveal(reveals);

// A quiet drone under the page while sound is on. It changes chord with
// the section crossing the middle of the screen: home, reflective, lifting
// through history, leaning forward into what's next, then home again.
program.pad();
var SECTION_CHORDS = [
  [".v-hero", "E"],
  [".v-today", "E"],
  [".v-wallet", "C#m"],
  [".v-tl", "A"],
  [".v-rewards", "B"],
  [".v-stake", "B"],
  [".v-final", "E"],
];
// The drone changing chord is felt more than heard, so the section that
// turned it shows it: its heading takes a sweep of light in the chord's
// colour (moving the way you're scrolling), breathes, grows a beam bar,
// or its kicker tints and opens up. Which one is rolled each time.
var padNow = "E";
var CHORD_COLOR = { E: 2, "C#m": 1, A: 3, B: 4 };
var chordLook = deckOf(["glint", "breathe", "bar", "kicker"]);

function chordShift(section, chord) {
  if (!motion || section === hero || !section.querySelector("h2")) return;
  section.style.setProperty("--c", COLORS[CHORD_COLOR[chord] || 0]);
  effect(section, "chord-" + chordLook());
  section.classList.toggle("chord-up", scrollDir < 0);
}

if ("IntersectionObserver" in window) {
  var chords = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var chord = entry.target._chord;
        if (chord !== padNow) chordShift(entry.target, chord);
        padNow = chord;
        program.padChord(chord);
      });
    },
    { rootMargin: "-50% 0px -50% 0px" },
  );
  SECTION_CHORDS.forEach(function (pair) {
    var el = document.querySelector(pair[0]);
    if (!el) return;
    el._chord = pair[1];
    chords.observe(el);
  });
}

// ---- Reveal sounds, once each, timed to the CSS transitions they score --

function onReveal(selector, play) {
  document.querySelectorAll(selector).forEach(function (el) {
    el.addEventListener("reveal", function () {
      play(el);
    }, { once: true });
  });
}

// White light enters the pane, then splits into the five beam colours: a
// low swell, then a strum up the ping's scale as the spectrum fans out
onReveal(".v-prism", function () {
  program.soft(0, 0.1);
  [0, 1, 2, 3, 4].forEach(function (step, i) {
    program.ping(step, 0.72 + i * 0.05);
  });
});

// The three steps rise in at 0, 0.35 and 0.7s
onReveal(".v-flow", function () {
  [0, 2, 4].forEach(function (step, i) {
    program.soft(step, i * 0.35);
  });
});

// Early access: "you" moves up the queue, a step up as it arrives
onReveal(".perk:has(.art-queue)", function () {
  program.soft(0, 0.3);
  program.soft(3, 1.3);
});

// Airdrops: a soft arrival, then one glass ping as the first token lands
// (70% of the 4.8s drop). Later drops stay silent.
onReveal(".perk:has(.art-drop)", function (el) {
  program.soft(2, 0.3);
  // Far enough off to fade with the card if the reader has scrolled on
  window.setTimeout(function () {
    program.ping(7, 0, el);
  }, 3360);
});

// Lower fees: the staked bar shrinks, so the notes step down
onReveal(".perk:has(.art-fees)", function () {
  [4, 2, 0].forEach(function (step, i) {
    program.soft(step, 0.3 + i * 0.5);
  });
});

// Fee share: the loop closes on a rolled chord
onReveal(".perk:has(.art-loop)", function () {
  [0, 2, 3, 5].forEach(function (step, i) {
    program.soft(step, 0.3 + i * 0.09);
  });
});

// ---- Closing chord: the final beam resolves the page, once per visit ---

// E major from the ping's own scale, coming home. Every arrival voices
// and rolls it differently: up, down, all at once, or slow and wide.
var closingRoll = deckOf([
  [0, 0.08, 0.16, 0.24, 0.4],
  [0.24, 0.16, 0.08, 0, 0.4],
  [0, 0, 0, 0, 0.3],
  [0, 0.2, 0.4, 0.6, 0.95],
]);
var finalBeam = document.querySelector(".v-final .beam");
if (finalBeam && "IntersectionObserver" in window) {
  var closing = new IntersectionObserver(
    function (entries) {
      if (!entries[0].isIntersecting) return;
      var f = flavour(1);
      var roll = closingRoll();
      [0, 2, 3, 5, 10].forEach(function (step, i) {
        program.play(i === 4 ? "glass" : f.voice, "pentatonic", step, roll[i], finalBeam);
      });
      if (motion) restart(finalBeam, "fx-closing");
      var closingHead = document.querySelector(".v-final .heading");
      if (closingHead) effect(closingHead, f.fx);
    },
    // Wait until it's well up the screen: at the bottom edge the ping's
    // on-screen fade would play it silently, and this only fires once
    { rootMargin: "0px 0px -40% 0px" },
  );
  closing.observe(finalBeam);
}
