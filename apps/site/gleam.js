// gleam.html, the Vision page. One clock drives everything: an example wallet
// holding 250 AO earns 250 points a day (POINTS.md § Rules), sped up 120×, so a
// whole point lands every 2.88s. The counters, the hero particles, the
// signals in "You earn GLEAM by" and the ping all read that clock, and it
// only runs while a counter or signal is on screen and the tab is visible.
(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var motion = !reducedMotion.matches;

  var PER_DAY = 250;
  var SPEED = 120;
  var PPS = (PER_DAY * SPEED) / 86400;
  var program = window.GleamProgram;
  var COLORS = program.COLORS;
  var colorFor = program.colorFor;
  var restart = program.restart;
  var format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

  // ---- Hero counter ----------------------------------------------------

  var gc = document.querySelector(".gc");
  var intEl = document.querySelector("[data-int]");
  var decEl = document.querySelector("[data-dec]");
  var gleamWord = document.querySelector(".v-gleam");
  var odometer =
    intEl &&
    program.odometer(intEl, function () {
      if (fx) fx.measure();
    });

  // ---- Mini counter at the timeline's "you are here" --------------------

  var mini = document.querySelector(".tl-now-count");
  var miniInt = document.querySelector("[data-mini]");
  var miniDec = document.querySelector("[data-mini-dec]");

  function plusOne() {
    if (!motion || !gc) return;
    var plus = document.createElement("span");
    plus.className = "gc-plus";
    plus.textContent = "+1";
    plus.addEventListener("animationend", function () {
      plus.remove();
    });
    gc.querySelector(".gc-num").appendChild(plus);
  }

  // Top corners and peaks of the letters in GLEAM, as % of the word's width
  var EDGES = [10, 22, 39, 66, 78, 96];

  function twinkle(point) {
    var star = document.createElement("span");
    star.className = "v-twinkle";
    star.setAttribute("aria-hidden", "true");
    // On a letter's top edge, half over the dark, or white-on-white hides it
    star.style.left = EDGES[Math.floor(rand(point * 11) * EDGES.length)] + "%";
    star.style.top = 15 + rand(point * 13) * 4 + "%";
    star.addEventListener("animationend", function () {
      star.remove();
    });
    gleamWord.appendChild(star);
  }

  // ---- Screen-reader echo, polite and at most every 30s -----------------

  var live = document.querySelector("[data-live]");
  var lastSpoken = -Infinity;

  function announce(point) {
    if (!live || Date.now() - lastSpoken < 30000) return;
    lastSpoken = Date.now();
    live.textContent =
      "Example: " + format.format(point) + (point === 1 ? " point" : " points");
  }

  // ---- Hero particles ----------------------------------------------------
  //
  // Every frame is drawn from the clock alone, so pausing and resuming can't
  // desync the particles from the counter. For point k, landing at T = k/PPS:
  //   [T-F-P, T-F]  a pulse rides the beam from the left edge to its end
  //   [T-F, T]      the pulse scatters into SHARDS that drift in and settle
  //                 on the counter
  // A steady drizzle between pulses is the fractional points accruing.

  var P = 0.9;
  var F = 1.1;
  var SHARDS = 12;
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
    return (
      u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
    );
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
    // seed picks its path; t is 0..1 through the flight, slowing as it
    // arrives so it settles rather than strikes.
    function flight(seed, t, spread, width, alpha) {
      var s = seed % 5;
      var x0 = g.bx;
      var y0 = stripeY(s);
      var dx = g.tx - x0;
      var x1 =
        x0 +
        dx * (0.15 + 0.5 * rand(seed * 3 + 1)) +
        (rand(seed * 3 + 7) - 0.5) * 80;
      var y1 = y0 + (rand(seed * 3 + 2) - 0.62) * spread;
      var x2 = g.tx + (rand(seed * 5 + 3) - 0.5) * g.tw * 1.6;
      var y2 = g.ty + (rand(seed * 5 + 4) - 0.5) * g.th * 2.2;
      var x3 = g.tx + (rand(seed * 7 + 5) - 0.5) * g.tw * 0.7;
      var y3 = g.ty + (rand(seed * 7 + 6) - 0.5) * g.th * 0.5;
      var e = 1 - (1 - t) * (1 - t);
      var e0 = Math.max(0, t - 0.09);
      e0 = 1 - (1 - e0) * (1 - e0);
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
        flight(
          j * 131 + 9,
          dt,
          spread * 0.6,
          1.2,
          0.55 * Math.sin(Math.PI * dt),
        );
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
          for (var i = 0; i < SHARDS; i++) {
            var seed = k * 977 + i * 5 + (i % 5);
            var lag = rand(seed + 11) * 0.22;
            var t = (b - lag) / (1 - lag);
            if (t > 0 && t < 1) flight(seed, t, spread, 1.6, 1 - t * t);
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
  var tlItems = tl
    ? Array.prototype.slice.call(tl.querySelectorAll(".tl-item"))
    : [];
  var now = tl && tl.querySelector(".tl-now");
  var tlGeo = { nowX: 0, range: 0, hold: 0, pan: 0, panTravel: 0 };
  var tlFrame = null;

  function layoutTimeline() {
    if (!tl) return;
    tlGeo.nowX = now.offsetLeft;
    tlItems.forEach(function (li) {
      li._x = li.offsetLeft;
    });
    track.style.setProperty("--now-x", tlGeo.nowX + "px");
    if (!motion) {
      tl.style.height = "";
      track.style.transform = "";
      track.style.removeProperty("--next");
      track.style.setProperty("--fill", tlGeo.nowX + "px");
      tlItems.forEach(function (li) {
        li.classList.add("lit");
      });
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
    // Extra pinned scroll after arrival: the launch line draws in and stays
    // readable before the section lets go
    tlGeo.hold = window.innerHeight * 0.9;
    tl.style.height = window.innerHeight + tlGeo.range + tlGeo.hold + "px";
    updateTimeline();
  }

  function updateTimeline() {
    tlFrame = null;
    if (!motion) return;
    var top = tl.getBoundingClientRect().top;
    var p = Math.min(1, Math.max(0, -top / tlGeo.range));
    var next = Math.min(1, Math.max(0, (-top - tlGeo.range) / (tlGeo.hold * 0.4)));
    track.style.setProperty("--next", next.toFixed(3));
    var head = p * tlGeo.nowX;
    var settle = Math.min(1, Math.max(0, (p - 0.82) / 0.18));
    settle = settle * settle * (3 - 2 * settle);
    var pan = tlGeo.panTravel + (tlGeo.pan - tlGeo.panTravel) * settle;
    var shift = Math.max(0, head - pan);
    track.style.transform = "translate3d(" + -shift + "px,0,0)";
    track.style.setProperty("--fill", head.toFixed(1) + "px");
    tlItems.forEach(function (li) {
      li.classList.toggle("lit", li._x <= head + 1);
    });
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

  var lines = Array.prototype.slice.call(
    document.querySelectorAll("[data-lines] > span"),
  );

  function updateLines() {
    var mark = window.innerHeight * 0.72;
    lines.forEach(function (span) {
      span.classList.toggle("lit", span.getBoundingClientRect().top < mark);
    });
  }

  // ---- One-shot reveals --------------------------------------------------

  var reveals = document.querySelectorAll(".reveal");
  program.reveal(reveals);

  // ---- The clock ---------------------------------------------------------

  var ticks = Array.prototype.slice.call(
    document.querySelectorAll("[data-tick]"),
  );
  var seen = {};
  var sim = 0;
  var shown = 0;
  var lastNow = null;
  var raf = 0;

  function running() {
    if (document.hidden) return false;
    return (
      seen.hero ||
      seen.today ||
      (seen.now && now && now.classList.contains("on"))
    );
  }

  function land(point) {
    var hit = colorFor(point);
    if (gc) {
      gc.style.setProperty("--hit", hit);
      gc.querySelectorAll(".od-s").forEach(function (strip, i) {
        strip.style.setProperty("--i", i);
      });
      if (motion) restart(gc, "land");
      plusOne();
    }
    // Real light catches a crystal irregularly, so GLEAM only glints on
    // some points; seeded so a replay looks the same.
    if (gleamWord && motion && rand(point * 7 + 3) < 0.45) {
      gleamWord.style.setProperty("--hit", hit);
      restart(gleamWord, "glow");
      twinkle(point);
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
    program.ping(point - 1);
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
    if (odometer) odometer.set(whole);
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

  if (motion && canvas && hero) fx = createFx();

  if ("IntersectionObserver" in window) {
    var gates = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        seen[entry.target.getAttribute("data-gate")] = entry.isIntersecting;
      });
      kick();
    });
    document.querySelectorAll("[data-gate]").forEach(function (el) {
      gates.observe(el);
    });
  } else {
    seen.hero = seen.today = seen.now = true;
    kick();
  }

  document.addEventListener("visibilitychange", kick);

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
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(onResize);
  layoutTimeline();
  updateLines();

  // Switching reduced motion mid-visit swaps every motion path at once
  reducedMotion.addEventListener("change", function () {
    motion = !reducedMotion.matches;
    if (motion && canvas && hero && !fx) fx = createFx();
    if (!motion && fx) {
      fx.clear();
      fx = null;
    }
    reveals.forEach(function (el) {
      el.classList.add("in");
    });
    onResize();
  });
})();
