// Flavours: each pass through a section sounds and moves its own way.
import { motion, program } from "./context.js";

//
// A pass is a run of scrolling one way through a section. Each new pass
// draws a voice, a scale and a visual effect from shuffled decks, so going
// over the same ground never plays the same twice running. Going back
// draws from backwards voices and effects: notes that swell and cut, glitches.

export function shuffled(items) {
  var d = items.slice();
  for (var i = d.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var swap = d[i];
    d[i] = d[j];
    d[j] = swap;
  }
  return d;
}

// Draws from items in a shuffled order, reshuffling when it runs out, and
// never the same one twice in a row across a reshuffle
export function deckOf(items) {
  var d = [];
  var last = null;
  return function () {
    if (!d.length) {
      d = shuffled(items);
      if (d.length > 1 && d[d.length - 1] === last) {
        d[d.length - 1] = d[0];
        d[0] = last;
      }
    }
    last = d.pop();
    return last;
  };
}

export var forwardVoice = deckOf(["glass", "box", "strum", "bell", "pluck", "swell"]);
var backVoice = deckOf(["reversed", "reversed", "pluck", "box", "swell"]);
var anyScale = deckOf(program.SCALES);
var forwardFx = deckOf(["pop", "ring", "prism", "rise"]);
var backFx = deckOf(["glitch", "implode", "smear", "flicker"]);

export function flavour(dir) {
  return {
    voice: dir > 0 ? forwardVoice() : backVoice(),
    scale: anyScale(),
    fx: dir > 0 ? forwardFx() : backFx(),
  };
}

var passes = {};

// The flavour for this section's current pass: a new one when the
// direction turns or after a pause
export function pass(key, dir) {
  var now = Date.now();
  var p = passes[key];
  if (!p || p.dir !== dir || now - p.at > 1500) {
    p = passes[key] = { dir: dir, flavour: flavour(dir) };
  }
  p.at = now;
  return p.flavour;
}

export function effect(el, fx) {
  if (!motion) return;
  el.className = el.className.replace(/\s*\bfx-\S+/g, "");
  void el.offsetWidth;
  el.classList.add("fx-" + fx);
}
