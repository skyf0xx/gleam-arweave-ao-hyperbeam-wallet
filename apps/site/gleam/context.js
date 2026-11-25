// Page-wide constants and the shared program helpers.

"use strict";

export var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
export var motion = !reducedMotion.matches;

var PER_DAY = 250;
var SPEED = 120;
export var PPS = (PER_DAY * SPEED) / 86400;
export var root = document.documentElement;
export var program = window.GleamProgram;
export var COLORS = program.COLORS;
export var colorFor = program.colorFor;
export var restart = program.restart;
export var format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function setMotion(v) {
  motion = v;
}
