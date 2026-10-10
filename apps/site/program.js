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
  // Off until asked for: browsers won't start audio before a click or key
  // press, so the button's own click is what unlocks it
  var soundOn = false;
  try {
    soundOn = localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    // Storage blocked: sound stays off for this visit.
  }

  var audio = null;
  // Major pentatonic from E6, one step per beam colour, so five points in a
  // row climb the beam
  var STEPS = [0, 2, 4, 7, 9];

  function armAudio() {
    markActive();
    if (audio) {
      if (audio.ctx.state === "suspended")
        audio.ctx.resume().then(function () {
          updatePad(1.2);
        });
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

    audio = { ctx: ctx, out: out, master: master, send: send, noise: noise };
    ctx.resume().then(function () {
      updatePad(1.2);
    });
  }

  function partial(freq, peak, decay, at, type) {
    // A high note's upper partials can land past hearing (and past what the
    // oscillator can play)
    if (freq > 18000) return;
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

  // How loud a ping from these elements should be: full while one sits near
  // the middle of the viewport, fading to silence as it scrolls off, so the
  // sound only lasts while you can see what makes it
  function presence(els) {
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
  function loudness(from) {
    var l = from ? presence([].concat(from)) : 1;
    if (l < 0.02) return 0;
    if (!soundOn) {
      hintSound();
      return 0;
    }
    if (!audio || audio.ctx.state !== "running") return 0;
    return l;
  }

  // step 0-4 walks the pentatonic from E6; each 5 above that climbs an octave
  function pitch(step) {
    var n = Math.max(0, Math.min(14, Math.floor(step)));
    return 1318.51 * Math.pow(2, (STEPS[n % 5] + 12 * Math.floor(n / 5)) / 12);
  }

  // The glass ping: bright and struck, for points and light
  function ping(step, delay, from) {
    var level = loudness(from);
    if (!level) return;
    var ctx = audio.ctx;
    var at = ctx.currentTime + 0.01 + (delay || 0);
    var f = pitch(step);
    if (f > 6000) f /= 4;
    duckPad(at);

    // Glass click: a few ms of filtered noise
    var click = ctx.createBufferSource();
    click.buffer = audio.noise;
    var band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 6800;
    band.Q.value = 1.4;
    var clickEnv = ctx.createGain();
    clickEnv.gain.setValueAtTime(0.16 * level, at);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.018);
    click.connect(band);
    band.connect(clickEnv);
    clickEnv.connect(audio.master);
    click.start(at);

    // The ring: a fundamental plus the inharmonic partials a struck glass bar has
    partial(f, 0.2 * level, 0.9, at);
    partial(f * 2.756, 0.07 * level, 0.34, at);
    partial(f * 5.404, 0.03 * level, 0.13, at);
    // A detuned octave a beat later makes it shimmer
    partial(f * 2.008, 0.045 * level, 1.3, at + 0.035);
    // A whisper of body underneath so it lands rather than floats
    partial(f / 4, 0.05 * level, 0.08, at, "triangle");
  }

  // The soft voice: two octaves under the ping, no strike, a slow swell. For
  // things arriving rather than sparkling, so the glass stays special.
  function soft(step, delay, from) {
    var level = loudness(from);
    if (!level) return;
    var ctx = audio.ctx;
    var at = ctx.currentTime + 0.01 + (delay || 0);
    var f = pitch(step) / 4;
    duckPad(at);
    [[1, 0.14, 0.7], [2, 0.03, 0.35], [3, 0.012, 0.2]].forEach(function (h) {
      var osc = ctx.createOscillator();
      osc.frequency.value = f * h[0];
      var env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(h[1] * level, at + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0001, at + h[2]);
      osc.connect(env);
      env.connect(audio.master);
      env.connect(audio.send);
      osc.start(at);
      osc.stop(at + h[2] + 0.05);
    });
  }

  // ---- The pad: a quiet E drone under everything, for pages that ask ------
  //
  // Root and fifth in the pings' key, so every note sits on it. It breathes on
  // a slow filter, swells a little while you scroll, dips under each note, and
  // fades away once you've stopped scrolling for a while.

  var PAD_REST = 0.03;
  var PAD_SWELL = 0.04;
  var PAD_IDLE_MS = 45000;
  // Voicings kept low and close so a change moves as little as it can: E3
  // holds through E, C#m and A, and B sits on its fifth so it leans home
  var CHORDS = {
    E: [82.41, 123.47, 164.81],
    "C#m": [69.3, 103.83, 164.81],
    A: [110, 138.59, 164.81],
    B: [92.5, 123.47, 155.56],
  };
  var padWanted = false;
  var padChord = "E";
  var pad = null;
  var padSwell = 0;
  var padSettle = 0;
  var lastActive = Date.now();
  var lastScroll = { y: window.scrollY, t: 0 };

  function buildPad() {
    var ctx = audio.ctx;
    var level = ctx.createGain();
    level.gain.value = 0;
    level.connect(audio.out);
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

    var built = { level: level, duck: duck, filter: filter, chord: null };
    built.chord = voice(built, CHORDS[padChord], 1);
    return built;
  }

  // One chord: each note a pair of saws a few cents apart so they slowly
  // beat. Saws, not sines: their upper harmonics are what laptop speakers can
  // actually play.
  function voice(into, freqs, start) {
    var ctx = audio.ctx;
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
  function setPadChord(name) {
    if (!CHORDS[name] || name === padChord) return;
    padChord = name;
    if (!pad) return;
    var now = audio.ctx.currentTime;
    var old = pad.chord;
    old.gain.gain.setTargetAtTime(0, now, 1.1);
    old.oscs.forEach(function (osc) {
      osc.stop(now + 7);
    });
    pad.chord = voice(pad, CHORDS[name], 0);
    pad.chord.gain.gain.setTargetAtTime(1, now, 1.1);
  }

  function padLevel() {
    if (!soundOn || document.hidden) return 0;
    if (Date.now() - lastActive > PAD_IDLE_MS) return 0;
    return PAD_REST + PAD_SWELL * padSwell;
  }

  // Glide the pad toward where it should be; tc is the fade's time constant
  // in seconds (about a third of how long it takes)
  function updatePad(tc) {
    if (!audio || audio.ctx.state !== "running") return;
    if (!pad) {
      if (!padWanted || !soundOn) return;
      pad = buildPad();
    }
    pad.level.gain.setTargetAtTime(padLevel(), audio.ctx.currentTime, tc);
  }

  // Make room for a note: a quick dip, then back over half a second
  function duckPad(at) {
    if (!pad) return;
    var g = pad.duck.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0.5, at, 0.02);
    g.setTargetAtTime(1, at + 0.12, 0.35);
  }

  function markActive() {
    var wasIdle = Date.now() - lastActive > PAD_IDLE_MS;
    lastActive = Date.now();
    if (wasIdle) updatePad(1.5);
  }

  window.addEventListener("scroll", function () {
    markActive();
    var now = performance.now();
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

  ["pointerdown", "keydown", "touchend"].forEach(function (type) {
    window.addEventListener(type, armAudio, { capture: true, passive: true });
  });

  var soundButton = document.querySelector(".v-sound");
  var soundLabel = soundButton && soundButton.querySelector("[data-sound-label]");

  function showSound() {
    soundButton.setAttribute("aria-pressed", String(soundOn));
    soundLabel.textContent = soundOn ? "Sound on" : "Sound off";
  }

  // A ping just played silently: the button glows in time with it, so the
  // visitor sees there's something to hear
  function hintSound() {
    if (!soundButton || soundButton.classList.contains("hint")) return;
    soundButton.classList.add("hint");
  }

  if (soundButton) {
    soundButton.hidden = false;
    showSound();
    soundButton.addEventListener("animationend", function () {
      soundButton.classList.remove("hint");
    });
    soundButton.addEventListener("click", function () {
      soundOn = !soundOn;
      try {
        localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
      } catch {
        // Storage blocked: the choice lasts for this visit only.
      }
      showSound();
      soundButton.classList.remove("hint");
      // armAudio already ran on pointerdown/keydown; this confirms it works
      if (soundOn && audio) {
        audio.ctx.resume().then(function () {
          ping(2);
          ping(4, 0.09);
          updatePad(1.2);
        });
      } else {
        updatePad(0.3);
      }
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
    soft: soft,
    pad: function () {
      padWanted = true;
      updatePad(1.2);
    },
    padChord: setPadChord,
    presence: presence,
    reveal: reveal,
  };
})();
