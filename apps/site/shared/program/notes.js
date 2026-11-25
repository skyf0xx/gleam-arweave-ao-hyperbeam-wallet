// The struck and swelled notes, and the thumps under them.
import { S } from "./state.js";
import { out, partial, loudness, pitch } from "./engine.js";
import { duckPad } from "./pad.js";

// The glass ping: bright and struck, for points and light
export function ping(step, delay, from) {
  glass(pitch(step), delay, from);
}

// The glass at any pitch. short: a music box's tine, not a bar.
export function glass(f, delay, from, short) {
  var level = loudness(from);
  if (!level) return;
  var ctx = S.audio.ctx;
  var at = ctx.currentTime + 0.01 + (delay || 0);
  var ring = short ? 0.35 : 1;
  while (f > 6000) f /= 4;
  duckPad(at);

  // Glass click: a few ms of filtered noise
  var click = ctx.createBufferSource();
  click.buffer = S.audio.noise;
  var band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 6800;
  band.Q.value = 1.4;
  var clickEnv = ctx.createGain();
  clickEnv.gain.setValueAtTime(0.16 * level, at);
  clickEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.018);
  click.connect(band);
  band.connect(clickEnv);
  clickEnv.connect(out());
  click.start(at);

  // The ring: a fundamental plus the inharmonic partials a struck glass bar has
  partial(f, 0.2 * level, 0.9 * ring, at);
  partial(f * 2.756, 0.07 * level, 0.34 * ring, at);
  partial(f * 5.404, 0.03 * level, 0.13 * ring, at);
  // A detuned octave a beat later makes it shimmer
  partial(f * 2.008, 0.045 * level, 1.3 * ring, at + 0.035);
  // A whisper of body underneath so it lands rather than floats
  partial(f / 4, 0.05 * level, 0.08, at, "triangle");
}

// The soft voice: two octaves under the ping, no strike, a slow swell. For
// things arriving rather than sparkling, so the glass stays special.
export function soft(step, delay, from) {
  swell(pitch(step) / 4, delay, from);
}

export function swell(f, delay, from) {
  var level = loudness(from);
  if (!level) return;
  var ctx = S.audio.ctx;
  var at = ctx.currentTime + 0.01 + (delay || 0);
  duckPad(at);
  [[1, 0.14, 0.7], [2, 0.03, 0.35], [3, 0.012, 0.2]].forEach(function (h) {
    var osc = ctx.createOscillator();
    osc.frequency.value = f * h[0];
    var env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(h[1] * level, at + 0.025);
    env.gain.exponentialRampToValueAtTime(0.0001, at + h[2]);
    osc.connect(env);
    env.connect(out());
    env.connect(S.audio.send);
    osc.start(at);
    osc.stop(at + h[2] + 0.05);
  });
}

// A plucked string: a bright attack that darkens fast, an octave under
// the glass, for things snapping into place
export function pluck(f, delay, from) {
  var level = loudness(from);
  if (!level) return;
  var ctx = S.audio.ctx;
  var at = ctx.currentTime + 0.01 + (delay || 0);
  duckPad(at);
  var tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.Q.value = 2;
  tone.frequency.setValueAtTime(f * 8, at);
  tone.frequency.exponentialRampToValueAtTime(f * 1.2, at + 0.35);
  tone.connect(out());
  tone.connect(S.audio.send);
  [["sawtooth", 1, 0.09], ["triangle", 2, 0.05]].forEach(function (v) {
    var osc = ctx.createOscillator();
    osc.type = v[0];
    osc.frequency.value = f * v[1];
    var env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(v[2] * level, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    osc.connect(env);
    env.connect(tone);
    osc.start(at);
    osc.stop(at + 0.65);
  });
}

// A note played backwards: it swells out of nothing and cuts dead. The
// sound of a tape running the wrong way.
export function reversed(f, delay, from) {
  var level = loudness(from);
  if (!level) return;
  var ctx = S.audio.ctx;
  var at = ctx.currentTime + 0.01 + (delay || 0);
  var rise = 0.32;
  duckPad(at + rise);
  [[1, 0.13], [2.756, 0.035], [2.008, 0.03]].forEach(function (h) {
    var osc = ctx.createOscillator();
    osc.frequency.value = f * h[0];
    var env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(h[1] * level, at + rise);
    env.gain.linearRampToValueAtTime(0, at + rise + 0.015);
    osc.connect(env);
    env.connect(out());
    osc.start(at);
    osc.stop(at + rise + 0.05);
  });
}

// Runs fn with its notes sent past the quiet master at gain, for the few
// moments that should land with weight rather than be found
export function loud(fn, gain) {
  if (!S.audio) return;
  var bus = S.audio.ctx.createGain();
  bus.gain.value = gain;
  bus.connect(S.audio.out);
  var prev = S.route;
  S.route = bus;
  try {
    fn();
  } finally {
    S.route = prev;
  }
}

// A low thump, a sine dropping out from under itself, felt more than
// heard. depth 1 is a knock; higher is a bigger hit.
export function thump(delay, depth) {
  var level = loudness();
  if (!level) return;
  var ctx = S.audio.ctx;
  var at = ctx.currentTime + 0.01 + (delay || 0);
  var d = depth || 1;
  duckPad(at);
  var osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(140 + 30 * d, at);
  osc.frequency.exponentialRampToValueAtTime(38, at + 0.18 + 0.06 * d);
  var env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(0.9 * level, at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.3 + 0.1 * d);
  osc.connect(env);
  env.connect(out());
  osc.start(at);
  osc.stop(at + 0.5 + 0.1 * d);
}

// An explosion: a burst of noise, bright at the crack and closing down to
// a rumble. size 1 is a pop; 2 and up fills the room.
export function boom(delay, size) {
  var level = loudness();
  if (!level) return;
  var ctx = S.audio.ctx;
  var at = ctx.currentTime + 0.01 + (delay || 0);
  var z = size || 1;
  var tail = 0.35 + 0.35 * z;
  if (!S.audio.rumble) {
    var len = Math.ceil(ctx.sampleRate * 1.6);
    S.audio.rumble = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = S.audio.rumble.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  duckPad(at);
  var src = ctx.createBufferSource();
  src.buffer = S.audio.rumble;
  var tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.Q.value = 0.8;
  tone.frequency.setValueAtTime(1800 + 1400 * z, at);
  tone.frequency.exponentialRampToValueAtTime(90, at + tail);
  var env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(Math.min(1, 0.45 + 0.2 * z) * level, at + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, at + tail);
  src.connect(tone);
  tone.connect(env);
  env.connect(out());
  env.connect(S.audio.send);
  src.start(at);
  src.stop(at + tail + 0.05);
}
