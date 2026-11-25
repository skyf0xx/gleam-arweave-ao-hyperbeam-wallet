// Tokenomics steps.
import { COLORS, motion, program } from "./context.js";
import { effect, pass } from "./flavours.js";

//
// Each step crossing the reading line sounds its note and its heading
// takes the pass's effect. Going down, its number lights in its beam
// colour and keeps a ring; going up, the ring clears on a falling note. A
// spark rides the rail to the furthest step passed, and back up with you.

export var flow = document.querySelector(".v-flow");
var steps = flow ? Array.prototype.slice.call(flow.querySelectorAll(".v-step")) : [];
var STEP_COLORS = [0, 2, 4];
var STEP_DEGREES = [0, 2, 4];
var railSpark = null;

if (flow) {
  steps.forEach(function (step, i) {
    step.style.setProperty("--c", COLORS[STEP_COLORS[i]]);
  });
  railSpark = document.createElement("span");
  railSpark.className = "v-flow-spark";
  railSpark.setAttribute("aria-hidden", "true");
  flow.appendChild(railSpark);
}

// audible: true only for a scroll
export function updateSteps(audible) {
  if (!flow) return;
  var mark = window.innerHeight * 0.62;
  var shown = flow.classList.contains("in");
  var furthest = -1;
  steps.forEach(function (step, i) {
    var num = step.querySelector(".v-step-n");
    var r = num.getBoundingClientRect();
    var past = r.top + r.height / 2 < mark;
    var was = step.classList.contains("passed");
    step.classList.toggle("passed", past);
    if (past) furthest = i;
    if (!audible || !shown || past === was) return;
    var dir = past ? 1 : -1;
    var f = pass("steps", dir);
    program.play(f.voice, f.scale, STEP_DEGREES[i], 0, num);
    effect(step.querySelector("h3"), f.fx);
    if (!motion) return;
    num.style.animationDelay = "0s";
    num.classList.remove("count");
    void num.offsetWidth;
    num.classList.add("count");
  });
  if (!railSpark) return;
  railSpark.classList.toggle("on", furthest >= 0 && shown);
  if (furthest >= 0) {
    var node = steps[furthest].querySelector(".v-step-n");
    railSpark.style.top = steps[furthest].offsetTop + node.offsetHeight / 2 + "px";
    railSpark.style.setProperty("--c", COLORS[STEP_COLORS[furthest]]);
  }
}
