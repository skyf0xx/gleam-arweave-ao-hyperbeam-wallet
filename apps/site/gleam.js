// gleam.html, the Vision page. One clock drives everything: an example wallet
// holding 250 AO earns 250 points a day (POINTS.md § Rules), sped up 240×, so a
// whole point lands every 1.44s. The counters, the hero particles, the
// signals in "What points are today" and the ping all read that clock, and it
// only runs while a counter or signal is on screen and the tab is visible.
(function () {
  "use strict";

  var root = document.documentElement;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var motion = !reducedMotion.matches;
  root.classList.toggle("motion", motion);

  var PER_DAY = 250;
  var SPEED = 240;
  var PPS = (PER_DAY * SPEED) / 86400;
  var COLORS = ["#FF1717", "#8B12FF", "#73C9E8", "#FFE45C", "#28F02D"];
  var format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

  function colorFor(point) {
    return COLORS[(point - 1) % COLORS.length];
  }

  function restart(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ---- Hero counter: an odometer, one rolling column per digit ----------

  var gc = document.querySelector(".gc");
  var intEl = document.querySelector("[data-int]");
  var decEl = document.querySelector("[data-dec]");
  var columns = [];

  function buildOdometer(digits) {
    intEl.textContent = "";
    columns = [];
    for (var i = 0; i < digits; i++) {
      if (i > 0 && (digits - i) % 3 === 0) {
        var sep = document.createElement("span");
        sep.className = "od-sep";
        sep.textContent = ",";
        intEl.appendChild(sep);
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
      intEl.appendChild(col);
      columns.push({ strip: strip, digit: 0 });
    }
  }

  function onRollEnd(e) {
    var strip = e.currentTarget;
    if (strip.dataset.at !== "10") return;
    strip.classList.add("snap");
    strip.style.transform = "translateY(0)";
    strip.dataset.at = "0";
    void strip.offsetWidth;
    strip.classList.remove("snap");
  }

  function setOdometer(n) {
    var text = String(n);
    if (text.length !== columns.length) {
      buildOdometer(text.length);
      if (fx) fx.measure();
    }
    for (var i = 0; i < text.length; i++) {
      var d = text.charCodeAt(i) - 48;
      var col = columns[i];
      if (d === col.digit) continue;
      var at = d === 0 && col.digit === 9 && motion ? 10 : d;
      col.strip.style.transform = "translateY(" + -at + "em)";
      col.strip.dataset.at = String(at);
      col.digit = d;
    }
  }

  // ---- Mini counter at the timeline's "you are here" --------------------

  var mini = document.querySelector(".tl-now-count");
  var miniInt = document.querySelector("[data-mini]");
  var miniDec = document.querySelector("[data-mini-dec]");

  function plusOne() {
    if (!motion || !gc) return;
    var plus = document.createElement("span");
    plus.className = "gc-plus";
    plus.textContent = "+1";
    plus.addEventListener("animationend", function () { plus.remove(); });
    gc.querySelector(".gc-num").appendChild(plus);
  }

  // ---- Sound: a crystalline ping per point, made from scratch ------------

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

  function ping(point) {
    if (!soundOn || !audio || audio.ctx.state !== "running") return;
    var ctx = audio.ctx;
    var at = ctx.currentTime + 0.01;
    var f = 1318.51 * Math.pow(2, STEPS[(point - 1) % STEPS.length] / 12);

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
  var soundLabel = document.querySelector("[data-sound-label]");

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

  // ---- Screen-reader echo, polite and at most every 30s -----------------

  var live = document.querySelector("[data-live]");
  var lastSpoken = -Infinity;

  function announce(point) {
    if (!live || Date.now() - lastSpoken < 30000) return;
    lastSpoken = Date.now();
    live.textContent = "Example: " + format.format(point) + (point === 1 ? " point" : " points");
  }

  // ---- Hero particles ----------------------------------------------------
  //
  // Every frame is drawn from the clock alone, so pausing and resuming can't
  // desync the particles from the counter. For point k, landing at T = k/PPS:
  //   [T-F-P, T-F]  a pulse rides the beam from the left edge to its end
  //   [T-F, T]      the pulse shatters into SHARDS that converge on the counter
  //   [T, T+S]      a shockwave and sparks burst from the counter
  // A steady drizzle between pulses is the fractional points accruing.

  var P = 0.62;
  var F = 0.78;
  var S = 0.7;
  var SHARDS = 48;
  var SPARKS = 22;
  var DRIZZLE_EVERY = 1 / (50 * PPS);
  var DRIZZLE_LIFE = 1.15;

  function rand(seed) {
    var t = (seed + 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function bez(a, b, c, d, t) {
    var u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  }

  var fx = null;
  var hero = document.querySelector(".v-hero");
  var canvas = document.querySelector(".v-canvas");

  function createFx() {
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    var beam = document.querySelector(".v-beam");
    var target = document.querySelector(".gc-num");
    var g = { w: 0, h: 0, bx: 0, by: 0, bh: 10, tx: 0, ty: 0, tw: 0, th: 0 };
    var dpr = 1;
    var clean = true;

    function measure() {
      var box = hero.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      g.w = box.width;
      g.h = box.height;
      canvas.width = Math.round(g.w * dpr);
      canvas.height = Math.round(g.h * dpr);
      var b = beam.getBoundingClientRect();
      g.bx = b.right - box.left - b.width * 0.12;
      g.by = b.top - box.top;
      g.bh = b.height;
      var t = target.getBoundingClientRect();
      g.tx = t.left - box.left + t.width / 2;
      g.ty = t.top - box.top + t.height * 0.55;
      g.tw = t.width;
      g.th = t.height;
    }

    function stripeY(s) {
      return g.by + ((s + 0.5) * g.bh) / 5;
    }

    function line(x0, y0, x1, y1, color, width, alpha) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // A shard or drizzle mote flying from the beam's end into the counter.
    // seed picks its path; t is 0..1 through the flight, accelerating inward.
    function flight(seed, t, spread, width, alpha) {
      var s = seed % 5;
      var x0 = g.bx;
      var y0 = stripeY(s);
      var dx = g.tx - x0;
      var x1 = x0 + dx * (0.15 + 0.5 * rand(seed * 3 + 1)) + (rand(seed * 3 + 7) - 0.5) * 80;
      var y1 = y0 + (rand(seed * 3 + 2) - 0.62) * spread;
      var x2 = g.tx + (rand(seed * 5 + 3) - 0.5) * g.tw * 1.6;
      var y2 = g.ty + (rand(seed * 5 + 4) - 0.5) * g.th * 2.2;
      var x3 = g.tx + (rand(seed * 7 + 5) - 0.5) * g.tw * 0.7;
      var y3 = g.ty + (rand(seed * 7 + 6) - 0.5) * g.th * 0.5;
      var e = t * t;
      var e0 = Math.max(0, t - 0.09);
      e0 *= e0;
      var ax = bez(x0, x1, x2, x3, e0);
      var ay = bez(y0, y1, y2, y3, e0);
      var bx = bez(x0, x1, x2, x3, e);
      var by = bez(y0, y1, y2, y3, e);
      // A wide faint pass under a thin bright one reads as glow without shadowBlur's cost
      line(ax, ay, bx, by, COLORS[s], width * 4, alpha * 0.18);
      line(ax, ay, bx, by, COLORS[s], width, alpha);
    }

    function draw(sim) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, g.w, g.h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      clean = false;

      var v = sim * PPS;
      var spread = Math.max(120, Math.abs(g.ty - g.by) * 1.4);

      // Drizzle
      var first = Math.max(0, Math.ceil((sim - DRIZZLE_LIFE) / DRIZZLE_EVERY));
      var last = Math.floor(sim / DRIZZLE_EVERY);
      for (var j = first; j <= last; j++) {
        var dt = (sim - j * DRIZZLE_EVERY) / DRIZZLE_LIFE;
        if (dt < 0 || dt > 1) continue;
        flight(j * 131 + 9, dt, spread * 0.6, 1.2, 0.55 * Math.sin(Math.PI * dt));
      }

      // Pulses and shards for the next whole point or two
      for (var k = Math.max(1, Math.floor(v)); k <= Math.floor(v) + 2; k++) {
        var T = k / PPS;
        var a = (sim - (T - F - P)) / P;
        if (a >= 0 && a < 1) {
          var hx = g.bx * (a * a * (3 - 2 * a));
          for (var s = 0; s < 5; s++) {
            var y = stripeY(s);
            var grad = ctx.createLinearGradient(hx - 180, 0, hx, 0);
            grad.addColorStop(0, "rgba(255,255,255,0)");
            grad.addColorStop(1, COLORS[s]);
            line(Math.max(0, hx - 180), y, hx, y, grad, 2.4, 1);
          }
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(hx, g.by + g.bh / 2, 3 + 3 * a, 0, Math.PI * 2);
          ctx.fill();
        }
        var b = (sim - (T - F)) / F;
        if (b >= 0 && b < 1) {
          if (b < 0.2) {
            ctx.globalAlpha = 1 - b / 0.2;
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(g.bx, g.by + g.bh / 2, 6 + 40 * b, 0, Math.PI * 2);
            ctx.fill();
          }
          for (var i = 0; i < SHARDS; i++) {
            var seed = k * 977 + i * 5 + (i % 5);
            var lag = rand(seed + 11) * 0.22;
            var t = (b - lag) / (1 - lag);
            if (t > 0 && t < 1) flight(seed, t, spread, 2.6, 1);
          }
        }
      }

      // Burst from the point that just landed
      var landed = Math.floor(v);
      if (landed >= 1) {
        var u = (sim - landed / PPS) / S;
        if (u >= 0 && u < 1) {
          var hit = colorFor(landed);
          var ease = 1 - Math.pow(1 - u, 3);
          ctx.globalAlpha = 1 - u;
          ctx.strokeStyle = hit;
          ctx.lineWidth = 3 * (1 - u) + 0.5;
          ctx.beginPath();
          ctx.ellipse(g.tx, g.ty, g.tw * 0.35 + 260 * ease, g.th * 0.3 + 150 * ease, 0, 0, Math.PI * 2);
          ctx.stroke();
          for (var q = 0; q < SPARKS; q++) {
            var r = landed * 313 + q;
            var ang = rand(r) * Math.PI * 2;
            var spd = 260 + rand(r + 1) * 520;
            var d1 = (spd * (1 - Math.exp(-4 * u * S))) / 4;
            var d0 = (spd * (1 - Math.exp(-4 * Math.max(0, u - 0.06) * S))) / 4;
            var cx = Math.cos(ang);
            var cy = Math.sin(ang) * 0.75;
            var ox = g.tx + cx * g.tw * 0.3;
            var oy = g.ty + cy * g.th * 0.3;
            line(ox + cx * d0, oy + cy * d0, ox + cx * d1, oy + cy * d1, q % 3 ? hit : "#fff", 2, 1 - u);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    function clear() {
      if (clean) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      clean = true;
    }

    measure();
    return { measure: measure, draw: draw, clear: clear };
  }

  // ---- Timeline: page scroll drives history sideways ---------------------

  var tl = document.querySelector("[data-tl]");
  var tlViewport = tl && tl.querySelector(".tl-viewport");
  var track = tl && tl.querySelector(".tl-track");
  var tlItems = tl ? Array.prototype.slice.call(tl.querySelectorAll(".tl-item")) : [];
  var now = tl && tl.querySelector(".tl-now");
  var tlGeo = { nowX: 0, range: 0, pan: 0, panTravel: 0 };
  var tlFrame = null;

  function layoutTimeline() {
    if (!tl) return;
    tlGeo.nowX = now.offsetLeft;
    tlItems.forEach(function (li) { li._x = li.offsetLeft; });
    track.style.setProperty("--now-x", tlGeo.nowX + "px");
    if (!motion) {
      tl.style.height = "";
      track.style.transform = "";
      track.style.setProperty("--fill", tlGeo.nowX + "px");
      tlItems.forEach(function (li) { li.classList.add("lit"); });
      now.classList.add("on");
      tlViewport.scrollLeft = tlViewport.scrollWidth;
      return;
    }
    var vw = tlViewport.clientWidth;
    // The camera follows the beam's head mid-screen, then eases it left on
    // arrival so "Next" fits on the marker's right
    tlGeo.panTravel = vw * 0.55;
    tlGeo.pan = vw * (vw < 600 ? 0.18 : 0.3);
    tlGeo.range = tlGeo.nowX * 0.85;
    tl.style.height = window.innerHeight + tlGeo.range + "px";
    updateTimeline();
  }

  function updateTimeline() {
    tlFrame = null;
    if (!motion) return;
    var top = tl.getBoundingClientRect().top;
    var p = Math.min(1, Math.max(0, -top / tlGeo.range));
    var head = p * tlGeo.nowX;
    var settle = Math.min(1, Math.max(0, (p - 0.82) / 0.18));
    settle = settle * settle * (3 - 2 * settle);
    var pan = tlGeo.panTravel + (tlGeo.pan - tlGeo.panTravel) * settle;
    var shift = Math.max(0, head - pan);
    track.style.transform = "translate3d(" + -shift + "px,0,0)";
    track.style.setProperty("--fill", head.toFixed(1) + "px");
    tlItems.forEach(function (li) { li.classList.toggle("lit", li._x <= head + 1); });
    var on = p >= 0.995;
    if (on !== now.classList.contains("on")) {
      now.classList.toggle("on", on);
      kick();
    }
  }

  function requestTimeline() {
    if (tlFrame === null) tlFrame = requestAnimationFrame(updateTimeline);
  }

  // ---- The wallet: each sentence lights as it crosses the reading line ---

  var lines = Array.prototype.slice.call(document.querySelectorAll("[data-lines] > span"));

  function updateLines() {
    var mark = window.innerHeight * 0.72;
    lines.forEach(function (span) {
      span.classList.toggle("lit", span.getBoundingClientRect().top < mark);
    });
  }

  // ---- One-shot reveals --------------------------------------------------

  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && motion) {
    var revealer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.35 });
    reveals.forEach(function (el) { revealer.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  // ---- The clock ---------------------------------------------------------

  var ticks = Array.prototype.slice.call(document.querySelectorAll("[data-tick]"));
  var seen = {};
  var sim = 0;
  var shown = 0;
  var lastNow = null;
  var raf = 0;

  function running() {
    if (document.hidden) return false;
    return seen.hero || seen.today || (seen.now && now && now.classList.contains("on"));
  }

  function land(point) {
    var hit = colorFor(point);
    if (gc) {
      gc.style.setProperty("--hit", hit);
      if (motion) restart(gc, "land");
      plusOne();
    }
    if (mini && seen.now) {
      mini.style.setProperty("--hit", hit);
      if (motion) restart(mini, "land");
    }
    if (seen.today) {
      ticks.forEach(function (li) {
        li.style.setProperty("--hit", hit);
        restart(li, "tick");
      });
    }
    ping(point);
    announce(point);
  }

  function frame(t) {
    raf = 0;
    if (!running()) {
      lastNow = null;
      if (fx) fx.clear();
      return;
    }
    var dt = lastNow === null ? 0 : Math.min(0.05, (t - lastNow) / 1000);
    lastNow = t;
    sim += dt;
    var v = sim * PPS;
    var whole = Math.floor(v);
    if (intEl) setOdometer(whole);
    if (miniInt) miniInt.textContent = format.format(whole);
    var dec = "." + String(Math.floor((v - whole) * 100)).padStart(2, "0");
    if (decEl) decEl.textContent = dec;
    if (miniDec) miniDec.textContent = dec;
    if (whole > shown) {
      shown = whole;
      land(whole);
    }
    if (fx) {
      if (seen.hero) fx.draw(sim);
      else fx.clear();
    }
    raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!raf && running()) raf = requestAnimationFrame(frame);
  }

  if (intEl) buildOdometer(1);
  if (motion && canvas && hero) fx = createFx();

  if ("IntersectionObserver" in window) {
    var gates = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        seen[entry.target.getAttribute("data-gate")] = entry.isIntersecting;
      });
      kick();
    });
    document.querySelectorAll("[data-gate]").forEach(function (el) { gates.observe(el); });
  } else {
    seen.hero = seen.today = seen.now = true;
    kick();
  }

  document.addEventListener("visibilitychange", function () {
    root.classList.toggle("paused", document.hidden);
    kick();
  });

  function onScroll() {
    requestTimeline();
    updateLines();
  }

  function onResize() {
    if (fx) fx.measure();
    layoutTimeline();
    updateLines();
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
  layoutTimeline();
  updateLines();

  // Switching reduced motion mid-visit swaps every motion path at once
  reducedMotion.addEventListener("change", function () {
    motion = !reducedMotion.matches;
    root.classList.toggle("motion", motion);
    if (motion && canvas && hero && !fx) fx = createFx();
    if (!motion && fx) {
      fx.clear();
      fx = null;
    }
    reveals.forEach(function (el) { el.classList.add("in"); });
    onResize();
  });
})();
