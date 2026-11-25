// Points convert to GLEAM.
import { COLORS, motion, program } from "./context.js";
import { pass } from "./flavours.js";

//
// As the sentence crosses the reading line, a beam runs from "Points" to
// "GLEAM tokens" and GLEAM lights letter by letter in the beam colours,
// climbing a note each, the hero's GLEAM in miniature. Going back up, the
// letters go out in reverse and the light runs home to "Points".
// Pointing at "GLEAM tokens" lights it again.

var convert = document.querySelector(".v-convert");
var convertSide = 0;
var tokenLetters = [];
var convertBeam = null;

if (convert) {
  var word = convert.querySelector(".v-tokens-word");
  word.textContent.split("").forEach(function (ch, i) {
    var letter = document.createElement("i");
    letter.textContent = ch;
    letter.style.setProperty("--c", COLORS[i % 5]);
    tokenLetters.push(letter);
  });
  word.textContent = "";
  tokenLetters.forEach(function (letter) {
    word.appendChild(letter);
  });
  convertBeam = document.createElement("span");
  convertBeam.className = "v-convert-beam";
  convertBeam.setAttribute("aria-hidden", "true");
  convert.appendChild(convertBeam);
  convert.querySelector(".v-tokens").addEventListener("pointerenter", function (e) {
    if (e.pointerType !== "mouse") return;
    lightLetters(pass("tokens-hover", 1), 1, 0);
  });
}

// Lay the beam just under the words from "Points" to GLEAM, so it reads
// as light carried along, never a strike through. When GLEAM has wrapped
// to the next line, it runs to the end of the first line instead.
function placeBeam() {
  var box = convert.getBoundingClientRect();
  var a = convert.querySelector(".v-points").getBoundingClientRect();
  var b = convert.querySelector(".v-tokens-word").getBoundingClientRect();
  var x0 = a.left - box.left;
  var x1 = b.top > a.bottom - 2 ? box.width : b.left - box.left - 4;
  convertBeam.style.left = x0 + "px";
  convertBeam.style.top = a.bottom - box.top + 2 + "px";
  convertBeam.style.width = Math.max(0, x1 - x0) + "px";
}

function lightLetters(f, dir, start) {
  var order = dir > 0 ? tokenLetters : tokenLetters.slice().reverse();
  order.forEach(function (letter, k) {
    var i = tokenLetters.indexOf(letter);
    var at = start + k * 0.08;
    program.play(f.voice, f.scale, i, at, letter);
    if (!motion) return;
    letter.style.setProperty("--d", at + "s");
    letter.classList.remove("lit");
    void letter.offsetWidth;
    letter.classList.add("lit");
  });
}

function runBeam(dir, delay) {
  if (!motion) return;
  placeBeam();
  convertBeam.style.animationDelay = delay + "s";
  convertBeam.classList.remove("run", "back");
  void convertBeam.offsetWidth;
  convertBeam.classList.add("run");
  convertBeam.classList.toggle("back", dir < 0);
}

export function updateConvert() {
  if (!convert) return;
  var r = convert.getBoundingClientRect();
  var side = r.top + r.height / 2 < window.innerHeight * 0.7 ? 1 : -1;
  if (convertSide && side !== convertSide) {
    var f = pass("convert", side);
    if (side > 0) {
      program.soft(0, 0, convert);
      runBeam(1, 0);
      lightLetters(f, 1, 0.4);
    } else {
      lightLetters(f, -1, 0);
      runBeam(-1, 0.4);
      program.sweep(4, 0, 0.5, 0.4, convert);
    }
  }
  convertSide = side;
}
