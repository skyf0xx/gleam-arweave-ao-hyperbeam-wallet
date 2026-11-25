// The drone under the page.
import { S } from "./state.js";

// ---- The pad: a quiet E drone under everything, for pages that ask ------
//
// Root and fifth in the pings' key, so every note sits on it. It breathes on
// a slow filter, swells a little while you scroll, dips under each note, and
// fades away once you've stopped scrolling for a while.

var PAD_REST = 0.045;
var PAD_SWELL = 0.045;
var PAD_IDLE_MS = 45000;
// Voicings kept low and close so a change moves as little as it can: E3
// holds through E, C#m and A, and B sits on its fifth so it leans home
var CHORDS = {
  E: [82.41, 123.47, 164.81],
  "C#m": [69.3, 103.83, 164.81],
  A: [110, 138.59, 164.81],
  B: [92.5, 123.47, 155.56],
};
var padChord = "E";
var pad = null;
var padSwell = 0;
var padSettle = 0;
var lastActive = Date.now();
var lastScroll = { y: window.scrollY, t: 0 };

function buildPad() {
  var ctx = S.audio.ctx;
  var level = ctx.createGain();
  level.gain.value = 0;
  level.connect(S.audio.out);
  var duck = ctx.createGain();
  duck.connect(level);

  // Warm, not buzzy: everything above the low mids is filtered off, and the
  // cutoff drifts open and shut over about 20s so it breathes
  var filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 520;
  filter.Q.value = 0.6;
  filter.connect(duck);
  var lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  var depth = ctx.createGain();
  depth.gain.value = 260;
  lfo.connect(depth);
  depth.connect(filter.frequency);
  lfo.start();


  // Air: a faint band of noise above where the pings ring, for the glass
  var buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  var air = ctx.createBufferSource();
  air.buffer = buf;
  air.loop = true;
  var band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 5200;
  band.Q.value = 0.7;
  var airGain = ctx.createGain();
  airGain.gain.value = 0.05;
  air.connect(band);
  band.connect(airGain);
  airGain.connect(duck);
  air.start();

  var built = { level: level, duck: duck, filter: filter, chord: null, duckedUntil: 0 };
  built.chord = voice(built, CHORDS[padChord], 1);
  return built;
}

// One chord: each note a pair of saws a few cents apart so they slowly
// beat. Saws, not sines: their upper harmonics are what laptop speakers can
// actually play.
function voice(into, freqs, start) {
  var ctx = S.audio.ctx;
  var gain = ctx.createGain();
  gain.gain.value = start;
  gain.connect(into.filter);
  var oscs = [];
  freqs.forEach(function (f, i) {
    [-7, 7].forEach(function (cents) {
      var osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.detune.value = cents;
      var g = ctx.createGain();
      g.gain.value = [0.5, 0.3, 0.22][i];
      osc.connect(g);
      g.connect(gain);
      osc.start();
      oscs.push(osc);
    });
  });
  return { gain: gain, oscs: oscs };
}

// Crossfade to another chord over a few seconds, then let the old one go
export function setPadChord(name) {
  if (!CHORDS[name] || name === padChord) return;
  padChord = name;
  if (!pad) return;
  var now = S.audio.ctx.currentTime;
  var old = pad.chord;
  old.gain.gain.setTargetAtTime(0, now, 1.1);
  old.oscs.forEach(function (osc) {
    osc.stop(now + 7);
  });
  pad.chord = voice(pad, CHORDS[name], 0);
  pad.chord.gain.gain.setTargetAtTime(1, now, 1.1);
}

function padLevel() {
  if (!S.soundOn || document.hidden) return 0;
  if (Date.now() - lastActive > PAD_IDLE_MS) return 0;
  return PAD_REST + PAD_SWELL * padSwell;
}

// Glide the pad toward where it should be; tc is the fade's time constant
// in seconds (about a third of how long it takes)
export function updatePad(tc) {
  if (!S.audio || S.audio.ctx.state !== "running") return;
  if (!pad) {
    if (!S.padWanted || !S.soundOn) return;
    pad = buildPad();
  }
  pad.level.gain.setTargetAtTime(padLevel(), S.audio.ctx.currentTime, tc);
}

// Make room for a note: a shallow dip, then back over half a second. One
// dip at a time, so a run of notes can't hold the drone down under them.
export function duckPad(at) {
  if (!pad || at < pad.duckedUntil) return;
  pad.duckedUntil = at + 0.4;
  var g = pad.duck.gain;
  g.cancelScheduledValues(at);
  g.setTargetAtTime(0.75, at, 0.02);
  g.setTargetAtTime(1, at + 0.12, 0.35);
}

export function markActive() {
  var wasIdle = Date.now() - lastActive > PAD_IDLE_MS;
  lastActive = Date.now();
  if (wasIdle) updatePad(1.5);
}

window.addEventListener("scroll", function () {
  markActive();
  var now = window.performance.now();
  var dt = now - lastScroll.t;
  var speed = dt > 0 && dt < 250 ? Math.abs(window.scrollY - lastScroll.y) / dt : 0;
  lastScroll = { y: window.scrollY, t: now };
  // 2px/ms is a brisk flick: full swell
  padSwell = Math.min(1, padSwell * 0.7 + 0.3 * (speed / 2));
  updatePad(0.25);
  window.clearTimeout(padSettle);
  padSettle = window.setTimeout(function () {
    padSwell = 0;
    updatePad(1.2);
  }, 200);
}, { passive: true });

window.setInterval(function () {
  if (pad) updatePad(3);
}, 5000);

document.addEventListener("visibilitychange", function () {
  updatePad(0.3);
});
