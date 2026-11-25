// Voices and scales: the same melody, played many ways.
import { S } from "./state.js";
import { out, loudness, pitch } from "./engine.js";
import { glass, swell, pluck, reversed } from "./notes.js";
import { duckPad } from "./pad.js";

// ---- Voices and scales: the same melody, played many ways ---------------
//
// A section that sounds as it's passed picks a voice and a scale for each
// pass, so a milestone rung twice never quite sounds the same.

export var VOICES = {
  glass: function (f, d, from) {
    glass(f, d, from);
  },
  box: function (f, d, from) {
    glass(f * 2, d, from, true);
  },
  strum: function (f, d, from) {
    [1, 1.26, 1.498].forEach(function (m, i) {
      glass(f * m, d + i * 0.035, from);
    });
  },
  bell: function (f, d, from) {
    glass(f, d, from);
    swell(f / 2, d, from);
  },
  swell: function (f, d, from) {
    swell(f / 4, d, from);
  },
  pluck: function (f, d, from) {
    pluck(f / 2, d, from);
  },
  reversed: function (f, d, from) {
    reversed(f / 2, d, from);
  },
};

// Semitones above E. All start on E, so every one sits on the pad.
export var SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  wholeTone: [0, 2, 4, 6, 8, 10],
  exotic: [0, 1, 4, 5, 7, 8, 11],
  fifths: [0, 7, 14, 21, 28],
};

// degree counts up the scale, climbing an octave each time round it. Each
// note sits in the stereo field where its element is on screen, a few
// cents off true and a hair off the beat, so no two plays are identical.
export function play(voice, scale, degree, delay, from) {
  var notes = SCALES[scale] || SCALES.pentatonic;
  var n = Math.max(0, Math.floor(degree));
  var semis = notes[n % notes.length] + 12 * Math.floor(n / notes.length);
  var f = 1318.51 * Math.pow(2, (semis + (Math.random() - 0.5) * 0.2) / 12);
  while (f > 5300) f /= 2;
  var d = (delay || 0) + Math.random() * 0.015;
  var panner = null;
  if (S.audio && S.audio.ctx.createStereoPanner && S.audio.ctx.state === "running") {
    panner = S.audio.ctx.createStereoPanner();
    panner.pan.value = panFor(from);
    panner.connect(S.audio.master);
  }
  S.route = panner;
  try {
    (VOICES[voice] || VOICES.glass)(f, d, from);
  } finally {
    S.route = null;
  }
}

function panFor(from) {
  var el = from && [].concat(from)[0];
  var x = 0;
  if (el && el.getBoundingClientRect) {
    var r = el.getBoundingClientRect();
    x = ((r.left + r.width / 2) / (window.innerWidth || 1)) * 2 - 1;
  }
  return Math.max(-0.8, Math.min(0.8, x * 0.7 + (Math.random() - 0.5) * 0.2));
}

// Air moving past: a band of noise swept up for a scroll down, down for a
// scroll up. Its colour and length are rolled fresh each time.
export function whoosh(dir, strength) {
  var level = loudness();
  if (!level) return;
  var ctx = S.audio.ctx;
  var at = ctx.currentTime + 0.01;
  var dur = 0.35 + Math.random() * 0.3;
  var lo = 300 + Math.random() * 500;
  var hi = 2400 + Math.random() * 3000;
  if (!S.audio.air) {
    var buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    S.audio.air = buf;
  }
  var src = ctx.createBufferSource();
  src.buffer = S.audio.air;
  var band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.8 + Math.random() * 2.5;
  band.frequency.setValueAtTime(dir > 0 ? lo : hi, at);
  band.frequency.exponentialRampToValueAtTime(dir > 0 ? hi : lo, at + dur);
  var env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(0.09 * strength * level, at + dur * 0.4);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(band);
  band.connect(env);
  if (ctx.createStereoPanner) {
    var pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.8;
    env.connect(pan);
    pan.connect(S.audio.master);
  } else {
    env.connect(S.audio.master);
  }
  src.start(at);
  src.stop(at + dur + 0.05);
}

// A glass tone gliding from one step to another: time running, not landing
export function sweep(fromStep, toStep, dur, delay, from) {
  var level = loudness(from);
  if (!level) return;
  var ctx = S.audio.ctx;
  var at = ctx.currentTime + 0.01 + (delay || 0);
  var f0 = pitch(fromStep) / 2;
  var f1 = pitch(toStep) / 2;
  duckPad(at);
  [[1, 0.07], [2.756, 0.018]].forEach(function (h) {
    var osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f0 * h[0], at);
    osc.frequency.exponentialRampToValueAtTime(f1 * h[0], at + dur);
    var env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(h[1] * level, at + 0.04);
    env.gain.setValueAtTime(h[1] * level, at + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.15);
    osc.connect(env);
    env.connect(out());
    env.connect(S.audio.send);
    osc.start(at);
    osc.stop(at + dur + 0.2);
  });
}

// A dry ratchet click: a few ms of noise, for things that turn
export function tick(delay, from) {
  var level = loudness(from);
  if (!level) return;
  var ctx = S.audio.ctx;
  var at = ctx.currentTime + 0.01 + (delay || 0);
  var click = ctx.createBufferSource();
  click.buffer = S.audio.noise;
  var band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3200;
  band.Q.value = 2;
  var env = ctx.createGain();
  env.gain.setValueAtTime(0.12 * level, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
  click.connect(band);
  band.connect(env);
  env.connect(out());
  click.start(at);
}
