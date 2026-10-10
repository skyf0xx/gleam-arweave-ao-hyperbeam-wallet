// Shared by the Gleam Points program pages: gleam.html, points.html and
// invite.html. Exposes window.GleamProgram: the beam colours, the odometer, the
// ping and its toggle, and one-shot reveals. Each page's own script drives them.
(function () {
  "use strict";

  var root = document.documentElement;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  root.classList.toggle("motion", !reducedMotion.matches);
  reducedMotion.addEventListener("change", function () {
    root.classList.toggle("motion", !reducedMotion.matches);
  });

  function motion() {
    return !reducedMotion.matches;
  }

  var COLORS = ["#FF1717", "#8B12FF", "#73C9E8", "#FFE45C", "#28F02D"];

  // Points cycle red, purple, sky, yellow, green, starting from point 1
  function colorFor(point) {
    return COLORS[(((point - 1) % 5) + 5) % 5];
  }

  function restart(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ---- Odometer: one rolling column per digit, commas between groups -----

  function onRollEnd(e) {
    var strip = e.currentTarget;
    if (strip.dataset.at !== "10") return;
    strip.classList.add("snap");
    strip.style.transform = "translateY(0)";
    strip.dataset.at = "0";
    void strip.offsetWidth;
    strip.classList.remove("snap");
  }

  // onGrow runs when the digit count changes, for callers that measure the
  // number. width zero-pads to a fixed number of digits.
  function odometer(el, onGrow, width) {
    var columns = [];

    function build(digits) {
      el.textContent = "";
      columns = [];
      for (var i = 0; i < digits; i++) {
        if (i > 0 && (digits - i) % 3 === 0) {
          var sep = document.createElement("span");
          sep.className = "od-sep";
          sep.textContent = ",";
          el.appendChild(sep);
        }
        var col = document.createElement("span");
        col.className = "od";
        var strip = document.createElement("span");
        strip.className = "od-s";
        // An eleventh 0 lets 9 roll forward into 0 before snapping back
        for (var d = 0; d <= 10; d++) {
          var cell = document.createElement("span");
          cell.textContent = String(d % 10);
          strip.appendChild(cell);
        }
        strip.addEventListener("transitionend", onRollEnd);
        col.appendChild(strip);
        el.appendChild(col);
        columns.push({ strip: strip, digit: 0 });
      }
    }

    function set(n) {
      var text = String(Math.max(0, Math.floor(n)));
      while (width && text.length < width) text = "0" + text;
      if (text.length !== columns.length) {
        build(text.length);
        // Commit the zeroed columns so the new digits roll in rather than appear
        void el.offsetWidth;
        if (onGrow) onGrow();
      }
      for (var i = 0; i < text.length; i++) {
        var d = text.charCodeAt(i) - 48;
        var col = columns[i];
        if (d === col.digit) continue;
        var at = d === 0 && col.digit === 9 && motion() ? 10 : d;
        col.strip.style.transform = "translateY(" + -at + "em)";
        col.strip.dataset.at = String(at);
        col.digit = d;
      }
    }

    build(width || 1);
    return { set: set };
  }

  // ---- Sound: a crystalline ping, made from scratch with Web Audio --------

  var SOUND_KEY = "gleam:sound";
  var soundOn = true;
  try {
    soundOn = localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    // Storage blocked: sound stays on for this visit.
  }

  var audio = null;
  // Major pentatonic from E6, one step per beam colour, so five points in a
  // row climb the beam
  var STEPS = [0, 2, 4, 7, 9];

  function armAudio() {
    if (audio) {
      if (audio.ctx.state === "suspended") audio.ctx.resume();
      return;
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = new Ctx();
    var out = ctx.createDynamicsCompressor();
    out.threshold.value = -18;
    out.connect(ctx.destination);
    var master = ctx.createGain();
    master.gain.value = 0.5;
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

    audio = { ctx: ctx, master: master, send: send, noise: noise };
    ctx.resume();
  }

  function partial(freq, peak, decay, at, type) {
    var ctx = audio.ctx;
    var osc = ctx.createOscillator();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    var env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(env);
    env.connect(audio.master);
    env.connect(audio.send);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }

  // step 0-4 walks the pentatonic; each 5 above that climbs an octave
  function ping(step, delay) {
    if (!soundOn || !audio || audio.ctx.state !== "running") return;
    var ctx = audio.ctx;
    var at = ctx.currentTime + 0.01 + (delay || 0);
    var n = Math.max(0, Math.min(14, Math.floor(step)));
    var f = 1318.51 * Math.pow(2, (STEPS[n % 5] + 12 * Math.floor(n / 5)) / 12);
    if (f > 6000) f /= 4;

    // Glass click: a few ms of filtered noise
    var click = ctx.createBufferSource();
    click.buffer = audio.noise;
    var band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 6800;
    band.Q.value = 1.4;
    var clickEnv = ctx.createGain();
    clickEnv.gain.setValueAtTime(0.16, at);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.018);
    click.connect(band);
    band.connect(clickEnv);
    clickEnv.connect(audio.master);
    click.start(at);

    // The ring: a fundamental plus the inharmonic partials a struck glass bar has
    partial(f, 0.2, 0.9, at);
    partial(f * 2.756, 0.07, 0.34, at);
    partial(f * 5.404, 0.03, 0.13, at);
    // A detuned octave a beat later makes it shimmer
    partial(f * 2.008, 0.045, 1.3, at + 0.035);
    // A whisper of body underneath so it lands rather than floats
    partial(f / 4, 0.05, 0.08, at, "triangle");
  }

  ["pointerdown", "keydown", "touchend"].forEach(function (type) {
    window.addEventListener(type, armAudio, { capture: true, passive: true });
  });

  var soundButton = document.querySelector(".v-sound");
  var soundLabel = soundButton && soundButton.querySelector("[data-sound-label]");

  function showSound() {
    soundButton.setAttribute("aria-pressed", String(soundOn));
    soundLabel.textContent = soundOn ? "Sound on" : "Sound off";
  }

  if (soundButton) {
    soundButton.hidden = false;
    showSound();
    soundButton.addEventListener("click", function () {
      soundOn = !soundOn;
      try {
        localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
      } catch {
        // Storage blocked: the choice lasts for this visit only.
      }
      showSound();
    });
  }

  // ---- One-shot reveals: .reveal gains .in the first time it's on screen --

  function reveal(els, threshold) {
    els = Array.prototype.slice.call(els);
    if (!("IntersectionObserver" in window) || !motion()) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
          entry.target.dispatchEvent(new window.CustomEvent("reveal"));
        }
      });
    }, { threshold: threshold || 0.35 });
    els.forEach(function (el) { observer.observe(el); });
  }

  reducedMotion.addEventListener("change", function () {
    if (reducedMotion.matches) {
      document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
    }
  });

  document.addEventListener("visibilitychange", function () {
    root.classList.toggle("paused", document.hidden);
  });

  window.GleamProgram = {
    COLORS: COLORS,
    colorFor: colorFor,
    motion: motion,
    restart: restart,
    odometer: odometer,
    ping: ping,
    reveal: reveal,
  };
})();
