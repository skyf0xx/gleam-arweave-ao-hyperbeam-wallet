// Scroll direction, and the air it moves.
import { COLORS, motion, program, root } from "./context.js";
import { reverseLoop } from "./fee-loop.js";

export var scrollDir = 1;
var lastY = window.scrollY;
var lastYAt = 0;
var lastWhoosh = 0;

// A brisk flick moves air: up or down, each with its own colour
export function trackScroll() {
  var t = window.performance.now();
  var dy = window.scrollY - lastY;
  var dt = t - lastYAt;
  lastY = window.scrollY;
  lastYAt = t;
  if (dy) scrollDir = dy > 0 ? 1 : -1;
  if (dy < 0) reverseLoop();
  if (!dy || dt <= 0 || dt > 120) return;
  var speed = Math.abs(dy) / dt;
  if (speed > 3 && t - lastWhoosh > 1500 && !root.classList.contains("gate")) {
    lastWhoosh = t;
    program.whoosh(scrollDir, Math.min(1, speed / 5));
    streaks(scrollDir);
  }
}

// The air made visible: two or three faint threads of beam colour racing
// the way the page went, at random places across the screen
function streaks(dir) {
  if (!motion) return;
  var n = 2 + Math.floor(Math.random() * 2);
  for (var i = 0; i < n; i++) {
    var thread = document.createElement("span");
    thread.className = "v-air" + (dir < 0 ? " up" : "");
    thread.setAttribute("aria-hidden", "true");
    thread.style.left = 4 + Math.random() * 92 + "%";
    thread.style.setProperty("--c", COLORS[Math.floor(Math.random() * 5)]);
    thread.style.animationDelay = i * 0.06 + Math.random() * 0.05 + "s";
    thread.style.animationDuration = 0.45 + Math.random() * 0.25 + "s";
    thread.addEventListener("animationend", function (e) {
      e.currentTarget.remove();
    });
    document.body.appendChild(thread);
  }
}
