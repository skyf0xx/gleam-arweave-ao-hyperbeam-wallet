// The hero counter, the timeline's mini counter and the screen-reader echo.
import { format, motion, program } from "./context.js";
import { fx, rand } from "./particles.js";

export var gc = document.querySelector(".gc");
var intEl = document.querySelector("[data-int]");
export var decEl = document.querySelector("[data-dec]");
export var gleamWord = document.querySelector(".v-gleam");
export var odometer =
  intEl &&
  program.odometer(intEl, function () {
    if (fx) fx.measure();
  });

// ---- Mini counter at the timeline's "you are here" --------------------

export var mini = document.querySelector(".tl-now-count");
export var miniInt = document.querySelector("[data-mini]");
export var miniDec = document.querySelector("[data-mini-dec]");

export function plusOne() {
  if (!motion || !gc) return;
  var plus = document.createElement("span");
  plus.className = "gc-plus";
  plus.textContent = "+1";
  plus.addEventListener("animationend", function () {
    plus.remove();
  });
  gc.querySelector(".gc-num").appendChild(plus);
}

// Top corners and peaks of the letters in GLEAM, as % of the word's width
var EDGES = [10, 22, 39, 66, 78, 96];

export function twinkle(point) {
  var star = document.createElement("span");
  star.className = "v-twinkle";
  star.setAttribute("aria-hidden", "true");
  // On a letter's top edge, half over the dark, or white-on-white hides it
  star.style.left = EDGES[Math.floor(rand(point * 11) * EDGES.length)] + "%";
  star.style.top = 15 + rand(point * 13) * 4 + "%";
  star.addEventListener("animationend", function () {
    star.remove();
  });
  gleamWord.appendChild(star);
}

// ---- Screen-reader echo, polite and at most every 30s -----------------

export var live = document.querySelector("[data-live]");
var lastSpoken = -Infinity;

export function announce(point) {
  if (!live || Date.now() - lastSpoken < 30000) return;
  lastSpoken = Date.now();
  live.textContent =
    "Example: " + format.format(point) + " GLEAM";
}
