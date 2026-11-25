// The launch: points carried into GLEAM, once per visit.
import { COLORS, motion, program, restart } from "./context.js";
import { mini } from "./counters.js";
import { deckOf, flavour } from "./flavours.js";
import { launch, launchBeam, launchLetters, launchOpen, launched, now, setLaunched, setTlFrame, tlFrame, updateTimeline } from "./timeline.js";

//
// When the dashes reach "GLEAM token launch", the present winds up (the dot
// draws in, the dashes march faster, a sweep climbs), then light runs along
// them and GLEAM lights letter by letter into the beam colours. It lands on
// one note an octave over the "You are here" chord, resolving it. A climax
// that replays on every nudge of the scroll wears thin, so it plays once
// and GLEAM keeps its colours. After that, each point earned rides the
// dashes into GLEAM as a spark (sendSpark). The dashes never fill like a
// progress bar: the launch has no date to measure against.

if (launch) {
  var launchWord = launch.querySelector(".tl-gleam");
  launchWord.textContent.split("").forEach(function (ch, i) {
    var letter = document.createElement("i");
    letter.textContent = ch;
    letter.style.setProperty("--c", COLORS[i % 5]);
    launchLetters.push(letter);
  });
  launchWord.textContent = "";
  launchLetters.forEach(function (letter) {
    launchWord.appendChild(letter);
  });
}

// audible: false when the page loads already past it, so it lands lit
// and silent instead of firing mid-read
export function launchGleam(audible) {
  if (!launch) return;
  setLaunched(true);
  if (!audible) {
    launch.classList.add("launched");
    return;
  }
  var dot = now.querySelector(".tl-now-dot") || now;
  // The wind-up: 0.35s drawing in before the release
  var windUp = 0.35;
  restart(now, "charging");
  program.sweep(3, 8, windUp, 0, dot);
  window.setTimeout(function () {
    restart(launchBeam, "run");
  }, windUp * 1000);
  window.setTimeout(function () {
    now.classList.remove("charging");
  }, 500);
  // The beam's light reaches the label 60% into its 0.6s run
  var land = windUp + 0.36;
  program.play("bell", "pentatonic", 10, land, launch);
  launchLetters.forEach(function (letter, k) {
    letter.style.setProperty("--d", k * 0.08 + "s");
  });
  window.setTimeout(function () {
    launch.classList.add("launched");
    launchLetters.forEach(function (letter) {
      restart(letter, "lit");
    });
  }, land * 1000);
}

// A point earned rides the dashes into GLEAM: it lifts off the counter,
// climbs to the line at the dot, runs along it and sinks into the letter
// of its own colour, which pulses as it arrives. Silent, since a note
// every 2.88s would wear.
export function sendSpark(point, hit) {
  if (!motion || !launched || !launchOpen) return;
  var letter = launchLetters[(point - 1) % launchLetters.length];
  if (!letter) return;
  var origin = now.getBoundingClientRect();
  var from = mini.querySelector(".tl-now-num").getBoundingClientRect();
  var to = letter.getBoundingClientRect();
  var spark = document.createElement("span");
  spark.className = "tl-spark";
  spark.setAttribute("aria-hidden", "true");
  spark.style.setProperty("--c", hit);
  now.appendChild(spark);
  var x0 = from.right - origin.left;
  var y0 = from.top + from.height * 0.3 - origin.top;
  var x1 = to.left + to.width / 2 - origin.left;
  var y1 = to.top + to.height / 2 - origin.top;
  var run = spark.animate(
    [
      { transform: "translate(" + x0 + "px," + y0 + "px) scale(0.4)", opacity: 0 },
      { transform: "translate(" + x0 * 0.5 + "px," + y0 * 0.4 + "px) scale(1)", opacity: 1, offset: 0.2 },
      { transform: "translate(14px,0) scale(1)", opacity: 1, offset: 0.35 },
      { transform: "translate(" + (x1 - 10) + "px,0) scale(1)", opacity: 1, offset: 0.85 },
      { transform: "translate(" + x1 + "px," + y1 + "px) scale(0.3)", opacity: 0 },
    ],
    { duration: 1400, easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
  );
  run.onfinish = function () {
    spark.remove();
    restart(letter, "pulse");
  };
}

var ROLLS = [
  [0.05, 0.05, 0.05],
  [0, 0.08, 0.16],
  [0.16, 0.08, 0],
  [0, 0.22, 0.44],
];
var arrivalRoll = deckOf(ROLLS);

export function arrive(dot) {
  var f = flavour(1);
  var roll = arrivalRoll();
  [5, 7, 8].forEach(function (degree, i) {
    program.play(f.voice, "pentatonic", degree, roll[i], dot);
  });
}

export function requestTimeline() {
  if (tlFrame === null)
    setTlFrame(requestAnimationFrame(function () {
      updateTimeline(true);
    }));
}
