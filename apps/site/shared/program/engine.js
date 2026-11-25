// The Web Audio graph and the primitives every sound is built from.
import { S } from "./state.js";
import { markActive, updatePad } from "./pad.js";
import { hintSound } from "./button.js";

// row climb the beam
var STEPS = [0, 2, 4, 7, 9];

export function armAudio() {
  markActive();
  if (S.audio) {
    if (S.audio.ctx.state === "suspended")
      S.audio.ctx.resume().then(function () {
        updatePad(1.2);
      });
    return;
  }
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  var ctx = new Ctx();
  var out = ctx.createDynamicsCompressor();
  out.threshold.value = -18;
  // The whole page's level, drone and notes together, set after the
  // compressor so turning it down doesn't change how the mix sits
  var volume = ctx.createGain();
  volume.gain.value = 0.85;
  out.connect(volume);
  volume.connect(ctx.destination);
  // Notes sit under the drone: quiet enough to be found ("was that me?")
  // rather than announced, so a reader leans in and turns it up
  var master = ctx.createGain();
  master.gain.value = 0.14;
  master.connect(out);

  // A short dark echo gives the glass a room to ring in
  var send = ctx.createGain();
  send.gain.value = 0.22;
  var delay = ctx.createDelay(1);
  delay.delayTime.value = 0.13;
  var feedback = ctx.createGain();
  feedback.gain.value = 0.3;
  var damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 3200;
  send.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  damp.connect(master);

  var noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.03), ctx.sampleRate);
  var data = noise.getChannelData(0);
  for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  S.audio = { ctx: ctx, out: out, master: master, send: send, noise: noise };
  ctx.resume().then(function () {
    updatePad(1.2);
  });
}

export function out() {
  return S.route || S.audio.master;
}

export function partial(freq, peak, decay, at, type) {
  // A high note's upper partials can land past hearing (and past what the
  // oscillator can play)
  if (freq > 18000) return;
  var ctx = S.audio.ctx;
  var osc = ctx.createOscillator();
  osc.type = type || "sine";
  osc.frequency.value = freq;
  var env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(peak, at + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(env);
  env.connect(out());
  env.connect(S.audio.send);
  osc.start(at);
  osc.stop(at + decay + 0.05);
}

// How loud a ping from these elements should be: full while one sits near
// the middle of the viewport, fading to silence as it scrolls off, so the
// sound only lasts while you can see what makes it
export function presence(els) {
  var vh = window.innerHeight || 1;
  var best = 0;
  els.forEach(function (el) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    // Not rendered at all. A zero-height box that is laid out still counts
    // (the timeline's items are, with their cards hung off them).
    if (!r.width && !r.height) return;
    var off = Math.abs(r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
    var t = Math.min(1, Math.max(0, (off - 0.25) / 0.75));
    best = Math.max(best, 1 - t * t * (3 - 2 * t));
  });
  return best;
}

// How loud a sound from these elements may play right now, or 0 if it
// shouldn't play at all. from: the element(s) making the sound; omit for
// one that's always full.
export function loudness(from) {
  var l = from ? presence([].concat(from)) : 1;
  if (l < 0.02) return 0;
  if (!S.soundOn) {
    hintSound();
    return 0;
  }
  if (!S.audio || S.audio.ctx.state !== "running") return 0;
  return l;
}

// step 0-4 walks the pentatonic from E6; each 5 above that climbs an octave
export function pitch(step) {
  var n = Math.max(0, Math.min(14, Math.floor(step)));
  return 1318.51 * Math.pow(2, (STEPS[n % 5] + 12 * Math.floor(n / 5)) / 12);
}
