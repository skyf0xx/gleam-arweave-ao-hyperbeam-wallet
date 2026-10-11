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
  var root = document.documentElement;
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
    return {
      measure: measure,
      draw: draw,
      clear: clear,
      ctx: ctx,
      g: g,
      line: line,
      flight: flight,
      stripeY: stripeY,
    };
  }

  // ---- Flavours: each pass through a section sounds and moves its own way --
  //
  // A pass is a run of scrolling one way through a section. Each new pass
  // draws a voice, a scale and a visual effect from shuffled decks, so going
  // over the same ground never plays the same twice running. Going back
  // draws from backwards voices and effects: notes that swell and cut, glitches.

  function shuffled(items) {
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
  function deckOf(items) {
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

  var forwardVoice = deckOf(["glass", "box", "strum", "bell", "pluck", "swell"]);
  var backVoice = deckOf(["reversed", "reversed", "pluck", "box", "swell"]);
  var anyScale = deckOf(program.SCALES);
  var forwardFx = deckOf(["pop", "ring", "prism", "rise"]);
  var backFx = deckOf(["glitch", "implode", "smear", "flicker"]);

  function flavour(dir) {
    return {
      voice: dir > 0 ? forwardVoice() : backVoice(),
      scale: anyScale(),
      fx: dir > 0 ? forwardFx() : backFx(),
    };
  }

  var passes = {};

  // The flavour for this section's current pass: a new one when the
  // direction turns or after a pause
  function pass(key, dir) {
    var now = Date.now();
    var p = passes[key];
    if (!p || p.dir !== dir || now - p.at > 1500) {
      p = passes[key] = { dir: dir, flavour: flavour(dir) };
    }
    p.at = now;
    return p.flavour;
  }

  function effect(el, fx) {
    if (!motion) return;
    el.className = el.className.replace(/\s*\bfx-\S+/g, "");
    void el.offsetWidth;
    el.classList.add("fx-" + fx);
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

  // audible: true only for a scroll, so a layout pass never chimes
  function updateTimeline(audible) {
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
    // Each milestone the beam reaches rings one step higher, so history
    // climbs a scale, and rewinding through it walks back down. Each pass
    // plays in its own voice and scale with its own effect. A fast scroll
    // changing several at once rolls them, capped so it never turns into a run.
    var rung = 0;
    tlItems.forEach(function (li, i) {
      var lit = li._x <= head + 1;
      if (audible && lit !== li.classList.contains("lit") && rung < 3) {
        var f = pass("tl", lit ? 1 : -1);
        program.play(f.voice, f.scale, i, rung * 0.07, li.querySelector(".tl-card") || li);
        li.style.setProperty("--c", COLORS[i % 5]);
        effect(li, f.fx);
        rung++;
      }
      li.classList.toggle("lit", lit);
    });
    var on = p >= 0.995;
    if (on !== now.classList.contains("on")) {
      now.classList.toggle("on", on);
      // Arriving at "You are here" lands on a chord, an octave over where
      // the timeline's scale began, voiced and rolled its own way each time.
      // Backing off the present rewinds it in one falling sweep.
      var dot = now.querySelector(".tl-now-dot") || now;
      if (on && audible) arrive(dot);
      if (!on && audible) program.sweep(8, 0, 0.7, 0, dot);
      kick();
    }
  }

  var ROLLS = [
    [0.05, 0.05, 0.05],
    [0, 0.08, 0.16],
    [0.16, 0.08, 0],
    [0, 0.22, 0.44],
  ];
  var arrivalRoll = deckOf(ROLLS);

  function arrive(dot) {
    var f = flavour(1);
    var roll = arrivalRoll();
    [5, 7, 8].forEach(function (degree, i) {
      program.play(f.voice, "pentatonic", degree, roll[i], dot);
    });
  }

  function requestTimeline() {
    if (tlFrame === null)
      tlFrame = requestAnimationFrame(function () {
        updateTimeline(true);
      });
  }

  // ---- The wallet: each sentence lights as it crosses the reading line ---

  var lines = Array.prototype.slice.call(
    document.querySelectorAll("[data-lines] > span"),
  );

  // audible: true only for a scroll. Each sentence lighting on the way down
  // sounds a note, the second higher than the first; going back up plays
  // them out backwards. Each pass picks its own voice and scale.
  function updateLines(audible) {
    var mark = window.innerHeight * 0.72;
    lines.forEach(function (span, i) {
      var lit = span.getBoundingClientRect().top < mark;
      if (audible && lit !== span.classList.contains("lit")) {
        var f = pass("lines", lit ? 1 : -1);
        program.play(f.voice, f.scale, [2, 5][i % 2], 0, span);
        span.style.setProperty("--c", COLORS[Math.floor(Math.random() * 5)]);
        effect(span, f.fx);
      }
      span.classList.toggle("lit", lit);
    });
  }

  // ---- The wallet's three ways in: underlined, one after another ----------
  //
  // As the sentence crosses the reading line, each choice's underline draws
  // in with its note: hardware wallet, existing key, new wallet. Going back
  // up they run out in reverse. Pointing at one plays it.

  var choices = Array.prototype.slice.call(document.querySelectorAll(".v-sub b"));
  var CHOICE_DEGREES = [0, 2, 4];

  // audible: true only for a scroll
  function updateChoices(audible) {
    var mark = window.innerHeight * 0.72;
    var changed = [];
    choices.forEach(function (b, i) {
      var lit = b.getBoundingClientRect().top < mark;
      if (lit !== b.classList.contains("lit")) changed.push(i);
    });
    if (!changed.length) return;
    var dir = choices[changed[0]].classList.contains("lit") ? -1 : 1;
    if (dir < 0) changed.reverse();
    var f = audible ? pass("choices", dir) : null;
    changed.forEach(function (i, k) {
      var b = choices[i];
      var delay = audible ? k * 0.16 : 0;
      b.style.transitionDelay = delay + "s";
      b.classList.toggle("back", dir < 0);
      b.classList.toggle("lit", dir > 0);
      if (!f) return;
      program.play(f.voice, f.scale, CHOICE_DEGREES[i], delay, b);
      b.style.animationDelay = delay + "s";
      effect(b, f.fx);
    });
  }

  choices.forEach(function (b, i) {
    b.addEventListener("pointerenter", function (e) {
      if (e.pointerType !== "mouse") return;
      var f = pass("choices-hover", 1);
      program.play(f.voice, f.scale, CHOICE_DEGREES[i], 0, b);
      b.style.animationDelay = "0s";
      effect(b, "ring");
    });
  });

  // ---- "You earn GLEAM by": each row plays its signal, forwards or back ---
  //
  // Crossing the reading line, Holding's ring pulses out on one note and
  // Inviting's light runs from you to your friend on a rising pair. Going
  // back up rewinds them: the ring falls inward, the light runs home, the
  // notes fall.

  var rows = Array.prototype.slice.call(document.querySelectorAll(".vision-today li"));

  // audible: true only for a scroll
  function updateRows(audible) {
    var mark = window.innerHeight * 0.65;
    rows.forEach(function (row, i) {
      var past = row.getBoundingClientRect().top + row.offsetHeight / 2 < mark;
      var was = row.classList.contains("passed");
      row.classList.toggle("passed", past);
      if (!audible || past === was) return;
      var dir = past ? 1 : -1;
      var f = pass("rows", dir);
      var notes = i === 0 ? [0] : dir > 0 ? [2, 3] : [3, 2];
      notes.forEach(function (degree, k) {
        program.play(f.voice, f.scale, degree, k * 0.4, row);
      });
      var word = row.querySelector("strong");
      if (word) effect(word, f.fx);
      var sig = row.querySelector(".v-sig");
      if (!sig || !motion) return;
      sig.style.setProperty("--hit", COLORS[Math.floor(Math.random() * 5)]);
      sig.classList.remove("sig-fwd", "sig-back");
      void sig.offsetWidth;
      sig.classList.add(dir > 0 ? "sig-fwd" : "sig-back");
    });
  }

  // ---- The prism: split again on the way down, gathered back going up -----
  //
  // After its first reveal, the prism replays whenever it crosses the
  // reading line. Down, white light enters and fans into five colours on a
  // rising strum. Up, the spectrum folds back into the pane and the white
  // light withdraws on a falling one, then it splits again.

  var prism = document.querySelector(".v-prism");
  var prismSide = 0;
  var prismBusy = 0;
  var prismArmed = false;

  function splitPrism(f) {
    // Snap to dark with transitions off, then let it split from there
    prism.classList.add("reset");
    prism.classList.remove("in");
    void prism.getBoundingClientRect();
    prism.classList.remove("reset");
    void prism.getBoundingClientRect();
    prism.classList.add("in");
    program.soft(0, 0.1, prism);
    [0, 1, 2, 3, 4].forEach(function (degree, i) {
      program.play(f.voice, f.scale, degree, 0.72 + i * 0.05, prism);
    });
  }

  function updatePrism() {
    if (!prism) return;
    var r = prism.getBoundingClientRect();
    var side = r.top + r.height / 2 < window.innerHeight * 0.6 ? 1 : -1;
    var crossed = prismSide && side !== prismSide;
    prismSide = side;
    if (!crossed || !motion || !prism.classList.contains("in") || Date.now() < prismBusy) return;
    // The first crossing is the reveal's own; replays start after it
    if (!prismArmed) {
      prismArmed = true;
      return;
    }
    if (side > 0) {
      prismBusy = Date.now() + 1700;
      splitPrism(pass("prism", 1));
      return;
    }
    prismBusy = Date.now() + 3000;
    var f = pass("prism", -1);
    prism.classList.add("gather");
    prism.classList.remove("in");
    [4, 3, 2, 1, 0].forEach(function (degree, i) {
      program.play(f.voice, f.scale, degree, i * 0.06, prism);
    });
    program.sweep(4, 0, 0.6, 0.45, prism);
    window.setTimeout(function () {
      prism.classList.remove("gather");
      splitPrism(flavour(1));
    }, 1300);
  }

  // ---- Headings that turn no chord: stake, and the closing line ------------

  var stakeHead = document.querySelector(".v-stake-h");
  var stakeSide = 0;

  function updateStakeHead() {
    if (!stakeHead) return;
    var r = stakeHead.getBoundingClientRect();
    var side = r.top + r.height / 2 < window.innerHeight * 0.65 ? 1 : -1;
    if (stakeSide && side !== stakeSide) {
      var f = pass("stake-h", side);
      (side > 0 ? [2, 5] : [5, 2]).forEach(function (degree, k) {
        program.play(f.voice, f.scale, degree, k * 0.18, stakeHead);
      });
      effect(stakeHead, f.fx);
    }
    stakeSide = side;
  }

  // ---- Points convert to GLEAM: light carries one into the other ---------
  //
  // As the sentence crosses the reading line, a beam runs from "Points" to
  // "GLEAM tokens" and GLEAM lights letter by letter in the beam colours,
  // climbing a note each, the hero's GLEAM in miniature. Going back up, the
  // letters go out in reverse and the light runs home to "Points".
  // Pointing at "GLEAM tokens" lights it again.

  var convert = document.querySelector(".v-convert");
  var convertSide = 0;
  var tokenLetters = [];
  var convertBeam = null;

  if (convert) {
    var word = convert.querySelector(".v-tokens-word");
    word.textContent.split("").forEach(function (ch, i) {
      var letter = document.createElement("i");
      letter.textContent = ch;
      letter.style.setProperty("--c", COLORS[i % 5]);
      tokenLetters.push(letter);
    });
    word.textContent = "";
    tokenLetters.forEach(function (letter) {
      word.appendChild(letter);
    });
    convertBeam = document.createElement("span");
    convertBeam.className = "v-convert-beam";
    convertBeam.setAttribute("aria-hidden", "true");
    convert.appendChild(convertBeam);
    convert.querySelector(".v-tokens").addEventListener("pointerenter", function (e) {
      if (e.pointerType !== "mouse") return;
      lightLetters(pass("tokens-hover", 1), 1, 0);
    });
  }

  // Lay the beam just under the words from "Points" to GLEAM, so it reads
  // as light carried along, never a strike through. When GLEAM has wrapped
  // to the next line, it runs to the end of the first line instead.
  function placeBeam() {
    var box = convert.getBoundingClientRect();
    var a = convert.querySelector(".v-points").getBoundingClientRect();
    var b = convert.querySelector(".v-tokens-word").getBoundingClientRect();
    var x0 = a.left - box.left;
    var x1 = b.top > a.bottom - 2 ? box.width : b.left - box.left - 4;
    convertBeam.style.left = x0 + "px";
    convertBeam.style.top = a.bottom - box.top + 2 + "px";
    convertBeam.style.width = Math.max(0, x1 - x0) + "px";
  }

  function lightLetters(f, dir, start) {
    var order = dir > 0 ? tokenLetters : tokenLetters.slice().reverse();
    order.forEach(function (letter, k) {
      var i = tokenLetters.indexOf(letter);
      var at = start + k * 0.08;
      program.play(f.voice, f.scale, i, at, letter);
      if (!motion) return;
      letter.style.setProperty("--d", at + "s");
      letter.classList.remove("lit");
      void letter.offsetWidth;
      letter.classList.add("lit");
    });
  }

  function runBeam(dir, delay) {
    if (!motion) return;
    placeBeam();
    convertBeam.style.animationDelay = delay + "s";
    convertBeam.classList.remove("run", "back");
    void convertBeam.offsetWidth;
    convertBeam.classList.add("run");
    convertBeam.classList.toggle("back", dir < 0);
  }

  function updateConvert() {
    if (!convert) return;
    var r = convert.getBoundingClientRect();
    var side = r.top + r.height / 2 < window.innerHeight * 0.7 ? 1 : -1;
    if (convertSide && side !== convertSide) {
      var f = pass("convert", side);
      if (side > 0) {
        program.soft(0, 0, convert);
        runBeam(1, 0);
        lightLetters(f, 1, 0.4);
      } else {
        lightLetters(f, -1, 0);
        runBeam(-1, 0.4);
        program.sweep(4, 0, 0.5, 0.4, convert);
      }
    }
    convertSide = side;
  }

  // ---- The rainbow arcs: drawn by the scroll, strummed by the pointer ------
  //
  // Each arc draws itself left to right as it scrolls up the screen, and
  // rubs itself out going back. Crossing into a colour band plays that
  // band's note, so the five colours run up a scale (and back down). The
  // pointer can strum it too, one string per band, and once drawn a bead of
  // light runs along it now and then. The arc's x is linear in its curve
  // parameter, so a band is just a fifth of the width.

  var arcs = Array.prototype.slice
    .call(document.querySelectorAll(".cut-curve"))
    .map(function (cut, i) {
      var path = cut.querySelector(".arc");
      if (!path) return null;
      var n = path.getAttribute("d").match(/-?[\d.]+/g).map(Number);
      return {
        key: "arc" + i,
        cut: cut,
        draw: cut.querySelector("#arc-draw-" + (i + 1) + " rect"),
        glint: cut.querySelector("#arc-glint-" + (i + 1) + " rect"),
        // Start, control and end y of the quadratic, in viewBox units
        y: [n[1], n[3], n[5]],
        bands: -1,
        string: -1,
        nextGlint: 0,
      };
    })
    .filter(Boolean);

  function arcY(arc, t) {
    var u = 1 - t;
    return u * u * arc.y[0] + 2 * u * t * arc.y[1] + t * t * arc.y[2];
  }

  // audible: true only for a scroll
  function updateArcs(audible) {
    var vh = window.innerHeight;
    arcs.forEach(function (arc) {
      var r = arc.cut.getBoundingClientRect();
      // Drawn from the bottom of the screen to a little over halfway up
      var p = motion ? Math.min(1, Math.max(0, (vh * 0.95 - r.top) / (vh * 0.45))) : 1;
      arc.draw.setAttribute("width", String(5 + p * 105));
      var bands = Math.min(5, Math.floor(p * 5 + 1e-6));
      if (audible && arc.bands >= 0 && bands !== arc.bands) {
        var dir = bands > arc.bands ? 1 : -1;
        var f = pass(arc.key, dir);
        // Bands crossed in one go roll, capped so a jump never turns into a run
        var crossed = [];
        for (var b = arc.bands; b !== bands; b += dir) crossed.push(dir > 0 ? b : b - 1);
        crossed.slice(-3).forEach(function (band, k) {
          program.play(f.voice, f.scale, band, k * 0.06, arc.cut);
        });
      }
      if (bands === 5 && arc.bands !== 5) arc.nextGlint = Date.now() + 2500;
      arc.bands = bands;
    });
  }

  function spark(arc, t, y, band) {
    if (!motion) return;
    var dot = document.createElement("span");
    dot.className = "arc-spark";
    dot.style.left = t * 100 + "%";
    dot.style.top = y + "px";
    dot.style.setProperty("--c", COLORS[band]);
    dot.addEventListener("animationend", function () {
      dot.remove();
    });
    arc.cut.appendChild(dot);
  }

  // Strum: crossing into a band near the line plucks it. Leaving the line
  // and coming back lets the same string ring again.
  function strum(arc, e, reach) {
    var r = arc.cut.getBoundingClientRect();
    var t = (e.clientX - r.left) / r.width;
    if (t < 0 || t > 1) return;
    var y = (arcY(arc, t) / 100) * r.height;
    var near = Math.abs(e.clientY - r.top - y) < reach;
    var band = Math.min(4, Math.floor(t * 5));
    if (!near || band >= arc.bands) {
      arc.string = -1;
      return;
    }
    if (band === arc.string && e.type !== "pointerdown") return;
    arc.string = band;
    var f = pass(arc.key + "-strum", 1);
    program.play(f.voice, f.scale, band, 0, arc.cut);
    spark(arc, t, y, band);
  }

  arcs.forEach(function (arc) {
    arc.cut.addEventListener("pointermove", function (e) {
      if (e.pointerType === "mouse") strum(arc, e, 26);
    });
    arc.cut.addEventListener("pointerdown", function (e) {
      strum(arc, e, 44);
    });
    arc.cut.addEventListener("pointerleave", function () {
      arc.string = -1;
    });
  });

  // A bead of light runs along a drawn arc every so often, chiming faintly
  // as it passes each colour
  var GLINT_S = 1.6;

  function glint(arc) {
    var start = null;
    function step(t) {
      if (start === null) start = t;
      var q = Math.min(1, (t - start) / (GLINT_S * 1000));
      var x = -8 + q * 112;
      arc.glint.setAttribute("x", String(x));
      arc.glint.setAttribute("width", q < 1 ? "8" : "0");
      if (q < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    var f = flavour(1);
    for (var b = 0; b < 5; b++) {
      program.play("box", f.scale, 5 + b, ((20 * b + 18) / 112) * GLINT_S, arc.cut);
    }
  }

  window.setInterval(function () {
    if (!motion || document.hidden) return;
    var now = Date.now();
    arcs.forEach(function (arc) {
      if (arc.bands !== 5 || now < arc.nextGlint) return;
      arc.nextGlint = now + 8000 + Math.random() * 6000;
      if (program.presence([arc.cut]) > 0.6) glint(arc);
    });
  }, 1000);

  // ---- Scroll direction, and the air it moves -------------------------------

  var scrollDir = 1;
  var lastY = window.scrollY;
  var lastYAt = 0;
  var lastWhoosh = 0;

  // A brisk flick moves air: up or down, each with its own colour
  function trackScroll() {
    var t = window.performance.now();
    var dy = window.scrollY - lastY;
    var dt = t - lastYAt;
    lastY = window.scrollY;
    lastYAt = t;
    if (dy) scrollDir = dy > 0 ? 1 : -1;
    if (dy < 0) reverseLoop();
    if (!dy || dt <= 0 || dt > 120) return;
    var speed = Math.abs(dy) / dt;
    if (speed > 3 && t - lastWhoosh > 1500 && !root.classList.contains("gate")) {
      lastWhoosh = t;
      program.whoosh(scrollDir, Math.min(1, speed / 5));
      streaks(scrollDir);
    }
  }

  // The air made visible: two or three faint threads of beam colour racing
  // the way the page went, at random places across the screen
  function streaks(dir) {
    if (!motion) return;
    var n = 2 + Math.floor(Math.random() * 2);
    for (var i = 0; i < n; i++) {
      var thread = document.createElement("span");
      thread.className = "v-air" + (dir < 0 ? " up" : "");
      thread.setAttribute("aria-hidden", "true");
      thread.style.left = 4 + Math.random() * 92 + "%";
      thread.style.setProperty("--c", COLORS[Math.floor(Math.random() * 5)]);
      thread.style.animationDelay = i * 0.06 + Math.random() * 0.05 + "s";
      thread.style.animationDuration = 0.45 + Math.random() * 0.25 + "s";
      thread.addEventListener("animationend", function (e) {
        e.currentTarget.remove();
      });
      document.body.appendChild(thread);
    }
  }

  // ---- The angled cuts: five strings, struck a new way each pass -----------
  //
  // Crossing the middle of the screen strikes a cut's five lines. Each pass
  // rolls how: in order (red first going down, green first going up), from
  // the middle out, all at once, or scattered; how fast; and how the lines
  // move as they're struck.

  var STRIKES = {
    run: function (dir) {
      return dir > 0 ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
    },
    outward: function () {
      return [2, 1, 3, 0, 4];
    },
    inward: function () {
      return [0, 4, 1, 3, 2];
    },
    scatter: function () {
      return shuffled([0, 1, 2, 3, 4]);
    },
    chord: function (dir) {
      return dir > 0 ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
    },
  };
  var strikeShape = deckOf(Object.keys(STRIKES));
  var strikeGap = deckOf([0.045, 0.07, 0.11, 0.16]);
  var strikeLook = deckOf(["flare", "slide", "flash", "jolt"]);

  var angles = Array.prototype.slice
    .call(document.querySelectorAll(".cut-angle"))
    .map(function (cut, i) {
      return { key: "angle" + i, cut: cut, lines: cut.querySelectorAll("line"), side: 0 };
    });

  function strike(a, dir) {
    var f = pass(a.key, dir);
    var shape = strikeShape();
    var order = STRIKES[shape](dir);
    var gap = shape === "chord" ? 0.012 : strikeGap();
    order.forEach(function (line, k) {
      // The line's own colour picks its note, so red is always the root
      program.play(f.voice, f.scale, line, k * gap, a.cut);
      a.lines[line].style.animationDelay = k * gap + "s";
    });
    if (!motion) return;
    a.cut.style.setProperty("--dir", dir);
    a.cut.className = a.cut.className.replace(/\s*\bstrike-\S+/g, "");
    void a.cut.offsetWidth;
    a.cut.classList.add("strike-" + strikeLook());
  }

  function updateAngles() {
    angles.forEach(function (a) {
      var r = a.cut.getBoundingClientRect();
      var side = r.top + r.height / 2 < window.innerHeight * 0.5 ? 1 : -1;
      if (a.side && side !== a.side && program.presence([a.cut]) > 0.3) strike(a, side);
      a.side = side;
    });
  }

  // ---- Stake cards: after their first reveal, each return is its own -------
  //
  // A card coming back into view on the way down lifts in on a rising figure;
  // on the way up it's rewound, a falling one in a backwards voice.

  var cardFx = { 1: deckOf(["lift", "tilt", "bloom"]), "-1": deckOf(["glitch", "smear", "flicker"]) };

  if ("IntersectionObserver" in window) {
    var cardsSeen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var card = entry.target;
          if (!entry.isIntersecting) {
            if (card._seen) card._away = true;
            return;
          }
          // The first sighting is the reveal's own; only returns count
          if (!card._seen) {
            card._seen = true;
            return;
          }
          if (!card._away) return;
          card._away = false;
          var dir = scrollDir;
          var f = flavour(dir);
          (dir > 0 ? [0, 2, 4] : [4, 2, 0]).forEach(function (degree, i) {
            program.play(f.voice, f.scale, degree, i * 0.09, card);
          });
          card.style.setProperty("--c", COLORS[Math.floor(Math.random() * 5)]);
          effect(card, cardFx[dir]());
        });
      },
      { threshold: 0.4 },
    );
    document.querySelectorAll(".perk").forEach(function (card) {
      cardsSeen.observe(card);
    });
  }

  // ---- Tokenomics steps: each one plays as it's passed, either way --------
  //
  // Each step crossing the reading line sounds its note and its heading
  // takes the pass's effect. Going down, its number lights in its beam
  // colour and keeps a ring; going up, the ring clears on a falling note. A
  // spark rides the rail to the furthest step passed, and back up with you.

  var flow = document.querySelector(".v-flow");
  var steps = flow ? Array.prototype.slice.call(flow.querySelectorAll(".v-step")) : [];
  var STEP_COLORS = [0, 2, 4];
  var STEP_DEGREES = [0, 2, 4];
  var railSpark = null;

  if (flow) {
    steps.forEach(function (step, i) {
      step.style.setProperty("--c", COLORS[STEP_COLORS[i]]);
    });
    railSpark = document.createElement("span");
    railSpark.className = "v-flow-spark";
    railSpark.setAttribute("aria-hidden", "true");
    flow.appendChild(railSpark);
  }

  // audible: true only for a scroll
  function updateSteps(audible) {
    if (!flow) return;
    var mark = window.innerHeight * 0.62;
    var shown = flow.classList.contains("in");
    var furthest = -1;
    steps.forEach(function (step, i) {
      var num = step.querySelector(".v-step-n");
      var r = num.getBoundingClientRect();
      var past = r.top + r.height / 2 < mark;
      var was = step.classList.contains("passed");
      step.classList.toggle("passed", past);
      if (past) furthest = i;
      if (!audible || !shown || past === was) return;
      var dir = past ? 1 : -1;
      var f = pass("steps", dir);
      program.play(f.voice, f.scale, STEP_DEGREES[i], 0, num);
      effect(step.querySelector("h3"), f.fx);
      if (!motion) return;
      num.style.animationDelay = "0s";
      num.classList.remove("count");
      void num.offsetWidth;
      num.classList.add("count");
    });
    if (!railSpark) return;
    railSpark.classList.toggle("on", furthest >= 0 && shown);
    if (furthest >= 0) {
      var node = steps[furthest].querySelector(".v-step-n");
      railSpark.style.top = steps[furthest].offsetTop + node.offsetHeight / 2 + "px";
      railSpark.style.setProperty("--c", COLORS[STEP_COLORS[furthest]]);
    }
  }

  // ---- Fee share loop: a chime at each stop, like a slow clock -------------
  //
  // As the value passes Use, Fees and Stakers, each stop lights in its
  // colour and sounds a note: Fees and Stakers climb the chord and Use, the
  // loop closing, comes in an octave up. Each lap takes a new voice. It
  // plays two laps each time the card comes into view, then just turns.
  // Scrolling up with it on screen runs the loop backwards, notes falling
  // to the low root, until the scroll stops.

  var loopArt = document.querySelector(".art-loop");
  var LOOP_MS = 10000;
  var LOOP_NOTES = 6;
  var loopCard = loopArt && loopArt.closest(".perk");
  var orbit = loopArt && loopArt.querySelector(".l-orbit");
  var loopNodes = loopArt ? loopArt.querySelectorAll(".l-node") : [];
  var loopState = { left: 0, seg: null, raf: 0, on: false, voice: null, back: 0 };

  function orbitAnimation() {
    var all = orbit && orbit.getAnimations ? orbit.getAnimations() : [];
    return all[0] || null;
  }

  function loopStop(station, dir) {
    var node = loopNodes[station];
    if (node && motion) {
      node.classList.remove("hit");
      void node.getBoundingClientRect();
      node.classList.add("hit");
    }
    if (dir > 0) {
      if (!loopState.voice) loopState.voice = forwardVoice();
      if (loopState.left > 0) {
        loopState.left--;
        program.play(loopState.voice, "pentatonic", [5, 2, 3][station], 0, loopArt);
      }
      // The lap closes on Use in its own voice; the next lap takes a new one
      if (station === 0) loopState.voice = forwardVoice();
    } else {
      program.play(pass("loop", -1).voice, "pentatonic", [0, 2, 3][station], 0, loopArt);
    }
  }

  function loopFrame() {
    loopState.raf = 0;
    if (!loopState.on) return;
    var a = orbitAnimation();
    if (a && a.currentTime !== null) {
      var t = ((a.currentTime % LOOP_MS) + LOOP_MS) % LOOP_MS;
      var seg = Math.floor(t / (LOOP_MS / 3));
      if (loopState.seg !== null && seg !== loopState.seg) {
        var dir = a.playbackRate < 0 ? -1 : 1;
        // Going forward the dot has reached the stop that begins this third;
        // going back it has passed the one that began the last
        loopStop(dir > 0 ? seg : loopState.seg, dir);
      }
      loopState.seg = seg;
    }
    loopState.raf = requestAnimationFrame(loopFrame);
  }

  function reverseLoop() {
    var a = loopState.on && orbitAnimation();
    if (!a) return;
    if (a.updatePlaybackRate) a.updatePlaybackRate(-1);
    else a.playbackRate = -1;
    window.clearTimeout(loopState.back);
    loopState.back = window.setTimeout(function () {
      if (a.updatePlaybackRate) a.updatePlaybackRate(1);
      else a.playbackRate = 1;
    }, 350);
  }

  if (loopCard && "IntersectionObserver" in window) {
    new IntersectionObserver(
      function (entries) {
        var entry = entries[entries.length - 1];
        if (entry.isIntersecting && !loopState.on) {
          loopState.on = true;
          loopState.left = LOOP_NOTES;
          loopState.seg = null;
          if (!loopState.raf) loopState.raf = requestAnimationFrame(loopFrame);
        } else if (!entry.isIntersecting) {
          loopState.on = false;
        }
      },
      { threshold: 0.5 },
    ).observe(loopCard);
  }

  // ---- One-shot reveals --------------------------------------------------

  var reveals = document.querySelectorAll(".reveal");
  program.reveal(reveals);

  // A quiet drone under the page while sound is on. It changes chord with
  // the section crossing the middle of the screen: home, reflective, lifting
  // through history, leaning forward into what's next, then home again.
  program.pad();
  var SECTION_CHORDS = [
    [".v-hero", "E"],
    [".v-today", "E"],
    [".v-wallet", "C#m"],
    [".v-tl", "A"],
    [".v-rewards", "B"],
    [".v-stake", "B"],
    [".v-final", "E"],
  ];
  // The drone changing chord is felt more than heard, so the section that
  // turned it shows it: its heading takes a sweep of light in the chord's
  // colour (moving the way you're scrolling), breathes, grows a beam bar,
  // or its kicker tints and opens up. Which one is rolled each time.
  var padNow = "E";
  var CHORD_COLOR = { E: 2, "C#m": 1, A: 3, B: 4 };
  var chordLook = deckOf(["glint", "breathe", "bar", "kicker"]);

  function chordShift(section, chord) {
    if (!motion || section === hero || !section.querySelector("h2")) return;
    section.style.setProperty("--c", COLORS[CHORD_COLOR[chord] || 0]);
    effect(section, "chord-" + chordLook());
    section.classList.toggle("chord-up", scrollDir < 0);
  }

  if ("IntersectionObserver" in window) {
    var chords = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var chord = entry.target._chord;
          if (chord !== padNow) chordShift(entry.target, chord);
          padNow = chord;
          program.padChord(chord);
        });
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    SECTION_CHORDS.forEach(function (pair) {
      var el = document.querySelector(pair[0]);
      if (!el) return;
      el._chord = pair[1];
      chords.observe(el);
    });
  }

  // ---- Reveal sounds, once each, timed to the CSS transitions they score --

  function onReveal(selector, play) {
    document.querySelectorAll(selector).forEach(function (el) {
      el.addEventListener("reveal", function () {
        play(el);
      }, { once: true });
    });
  }

  // White light enters the pane, then splits into the five beam colours: a
  // low swell, then a strum up the ping's scale as the spectrum fans out
  onReveal(".v-prism", function () {
    program.soft(0, 0.1);
    [0, 1, 2, 3, 4].forEach(function (step, i) {
      program.ping(step, 0.72 + i * 0.05);
    });
  });

  // The three steps rise in at 0, 0.35 and 0.7s
  onReveal(".v-flow", function () {
    [0, 2, 4].forEach(function (step, i) {
      program.soft(step, i * 0.35);
    });
  });

  // Early access: "you" moves up the queue, a step up as it arrives
  onReveal(".perk:has(.art-queue)", function () {
    program.soft(0, 0.3);
    program.soft(3, 1.3);
  });

  // Airdrops: a soft arrival, then one glass ping as the first token lands
  // (70% of the 4.8s drop). Later drops stay silent.
  onReveal(".perk:has(.art-drop)", function (el) {
    program.soft(2, 0.3);
    // Far enough off to fade with the card if the reader has scrolled on
    window.setTimeout(function () {
      program.ping(7, 0, el);
    }, 3360);
  });

  // Lower fees: the staked bar shrinks, so the notes step down
  onReveal(".perk:has(.art-fees)", function () {
    [4, 2, 0].forEach(function (step, i) {
      program.soft(step, 0.3 + i * 0.5);
    });
  });

  // Fee share: the loop closes on a rolled chord
  onReveal(".perk:has(.art-loop)", function () {
    [0, 2, 3, 5].forEach(function (step, i) {
      program.soft(step, 0.3 + i * 0.09);
    });
  });

  // ---- Closing chord: the final beam resolves the page, once per visit ---

  // E major from the ping's own scale, coming home. Every arrival voices
  // and rolls it differently: up, down, all at once, or slow and wide.
  var closingRoll = deckOf([
    [0, 0.08, 0.16, 0.24, 0.4],
    [0.24, 0.16, 0.08, 0, 0.4],
    [0, 0, 0, 0, 0.3],
    [0, 0.2, 0.4, 0.6, 0.95],
  ]);
  var finalBeam = document.querySelector(".v-final .beam");
  if (finalBeam && "IntersectionObserver" in window) {
    var closing = new IntersectionObserver(
      function (entries) {
        if (!entries[0].isIntersecting) return;
        var f = flavour(1);
        var roll = closingRoll();
        [0, 2, 3, 5, 10].forEach(function (step, i) {
          program.play(i === 4 ? "glass" : f.voice, "pentatonic", step, roll[i], finalBeam);
        });
        if (motion) restart(finalBeam, "fx-closing");
        var closingHead = document.querySelector(".v-final .heading");
        if (closingHead) effect(closingHead, f.fx);
      },
      // Wait until it's well up the screen: at the bottom edge the ping's
      // on-screen fade would play it silently, and this only fires once
      { rootMargin: "0px 0px -40% 0px" },
    );
    closing.observe(finalBeam);
  }

  // ---- The clock ---------------------------------------------------------

  var ticks = Array.prototype.slice.call(
    document.querySelectorAll("[data-tick]"),
  );
  var seen = {};
  var sim = 0;
  var shown = 0;
  // "You earn GLEAM by" sounds on its first four points per visit, taking
  // the lines in turn, then goes quiet
  var TODAY_SOUNDS = 4;
  var todaySounds = 0;
  var todayFlavour = null;
  var lastNow = null;
  var raf = 0;
  // A welcome-back moment. draw(e) paints over the hero's particles, e being
  // the seconds since it began; rate(e) sets how fast the clock runs (negative
  // runs it backwards) and hold stops it; end() runs as it finishes, with
  // sim0, the clock as the moment began, there to put time right again.
  var overlay = null;
  // The clock's speed from scrolling, 1 at rest
  var scrub = 1;
  var lastNotch = 0;

  function running() {
    if (document.hidden || root.classList.contains("gate")) return false;
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
    // Loud only while a counter is on screen
    program.ping(point - 1, 0, [gc, seen.now && mini]);
    // "You earn GLEAM by" has its own voice, and only for four points: a sound
    // on every one there gets wearing. Holding's single signal is one note;
    // Inviting's two are a pair, you then your friend, a third apart.
    if (seen.today && todaySounds < TODAY_SOUNDS && program.presence(ticks) > 0.5) {
      var line = ticks[todaySounds % ticks.length];
      // One voice for the visit's four, so they read as a set
      if (!todayFlavour) todayFlavour = flavour(1);
      if (todaySounds % ticks.length === 0) {
        program.play(todayFlavour.voice, todayFlavour.scale, 0, 0, line);
      } else {
        program.play(todayFlavour.voice, todayFlavour.scale, 2, 0, line);
        program.play(todayFlavour.voice, todayFlavour.scale, 3, 0.14, line);
      }
      todaySounds++;
    }
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
    var e = 0;
    if (overlay) {
      if (overlay.start === null) {
        overlay.start = t;
        overlay.sim0 = sim;
      }
      e = (t - overlay.start) / 1000;
      if (e >= overlay.dur) {
        if (overlay.end) overlay.end();
        overlay = null;
      }
    }
    // A flick of the scroll pushes time; it eases back to normal by itself
    scrub = 1 + (scrub - 1) * Math.exp(-dt / 0.3);
    var rate = scrub;
    if (overlay) rate = overlay.hold ? 0 : overlay.rate ? overlay.rate(e) : 1;
    sim = Math.max(0, sim + dt * rate);
    if (gc) gc.classList.toggle("scrub", Math.abs(rate) > 2.5);
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
    } else if (whole < shown) {
      // Running backwards, each point given up sounds the note it landed on.
      // A moment scores its own rewind, so only a scroll's does this.
      if (!overlay) program.ping((shown - 1) % 10, 0, gc);
      shown = whole;
    }
    // Fast time ratchets, four clicks a point, like tape on a spool
    var notch = Math.floor(v * 4);
    if (notch !== lastNotch && Math.abs(rate) > 2.5) program.tick(0, gc);
    lastNotch = notch;
    if (fx) {
      if (seen.hero) fx.draw(sim);
      else fx.clear();
    }
    if (overlay && overlay.draw && fx && seen.hero) overlay.draw(e);
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
        if (!seen.today) todayFlavour = null;
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

  // ---- Welcome back: a different moment each time the hero comes round -----
  //
  // Once the gate is behind them, a visitor who scrolls back up to the hero
  // after a few seconds away gets one short moment drawn from a shuffled
  // deck, so none repeats until all have played.

  function ease(t) {
    t = Math.min(1, Math.max(0, t));
    return t * t * (3 - 2 * t);
  }

  function spread() {
    return Math.max(120, Math.abs(fx.g.ty - fx.g.by) * 1.4);
  }

  // A beam pulse: a stripe's colour trailing to nothing behind its head
  function streak(s, hx, dir, alpha) {
    var ctx = fx.ctx;
    var y = fx.stripeY(s);
    var grad = ctx.createLinearGradient(hx - 180 * dir, 0, hx, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, COLORS[s]);
    fx.line(hx - 180 * dir, y, hx, y, grad, 2.4, alpha);
  }

  // Slow to a stop, then run backwards: the clock really reverses, so the
  // shards leave the counter for the beam and the count rolls down
  function slowThenBack(e) {
    if (e < 0.2) return 1 - e * 5;
    return e < 1.3 ? -12 : 0;
  }

  // Rewind, then snap back to the right time with a bright ping
  function rewind() {
    overlay = {
      start: null,
      dur: 1.6,
      rate: slowThenBack,
      end: function () {
        sim = this.sim0 + this.dur;
        if (gc) restart(gc, "burst");
        program.ping(10, 0, gc);
        program.ping(5, 0.04, gc);
      },
    };
    program.sweep(9, 0, 1.05, 0.2, gc);
  }

  // Rewind, a beat's pause, then fast-forward back to the right time
  function rewindCatchUp() {
    overlay = {
      start: null,
      dur: 2.9,
      rate: function (e) {
        if (e < 1.6) return slowThenBack(e);
        // Fast enough to arrive back at the true time just as it ends
        var behind = this.sim0 + e - sim;
        return Math.max(1, behind / Math.max(0.05, this.dur - e));
      },
      end: function () {
        sim = this.sim0 + this.dur;
        program.ping(10, 0, gc);
      },
    };
    program.sweep(9, 0, 1.05, 0.2, gc);
    program.sweep(0, 10, 1.2, 1.65, gc);
  }

  // Time spins up to 8x, the count races, then it eases back to normal
  function fastForward() {
    overlay = {
      start: null,
      dur: 1.9,
      rate: function (e) {
        var up = e < 0.3 ? ease(e / 0.3) : e < 1.2 ? 1 : 1 - ease((e - 1.2) / 0.7);
        return 1 + 7 * up;
      },
    };
    program.sweep(0, 10, 1.3, 0.05, gc);
  }

  // The beam is struck like a string: its stripes shake, a little out of
  // step, and settle under one low note
  function pluck() {
    var beam = document.querySelector(".v-beam");
    if (beam) restart(beam, "pluck");
    program.soft(0, 0, gc);
  }

  // One pulse per colour, all at once, each scattering into its own shards
  // and landing together on a chord
  function fiveAtOnce() {
    overlay = {
      start: null,
      dur: 1.9,
      hold: false,
      draw: function (e) {
        var sp = spread();
        for (var s = 0; s < 5; s++) {
          var a = (e - s * 0.05) / 0.7;
          if (a > 0 && a < 1) streak(s, fx.g.bx * ease(a), 1, 1);
          var b = (e - 0.75 - s * 0.05) / 0.9;
          if (b <= 0 || b >= 1) continue;
          for (var i = 0; i < 6; i++) {
            var t = Math.min(1, b * (1 + rand(i * 7 + s) * 0.3));
            if (t < 1) fx.flight((40 + i) * 5 + s, t, sp, 1.8, 1 - t * t);
          }
        }
        fx.ctx.globalAlpha = 1;
      },
    };
    program.soft(0, 0.1, gc);
    [0, 2, 3, 5].forEach(function (step, i) {
      program.ping(step, 1.6 + i * 0.03, gc);
    });
    window.setTimeout(function () {
      if (gc) restart(gc, "burst");
    }, 1600);
  }

  // GLEAM in the headline lights letter by letter, each in its beam colour,
  // climbing the scale
  function cascade() {
    if (!gleamWord) return;
    var over = document.createElement("span");
    over.className = "v-cascade";
    over.setAttribute("aria-hidden", "true");
    "GLEAM".split("").forEach(function (ch, i) {
      var letter = document.createElement("i");
      letter.textContent = ch;
      letter.style.setProperty("--c", COLORS[i]);
      letter.style.animationDelay = i * 0.09 + "s";
      over.appendChild(letter);
    });
    over.lastChild.addEventListener("animationend", function () {
      over.remove();
    });
    gleamWord.appendChild(over);
    [0, 1, 2, 3, 4].forEach(function (step, i) {
      program.ping(step, 0.05 + i * 0.09, gleamWord);
    });
    program.ping(5, 0.6, gleamWord);
  }

  // The counter's digits spin a full turn, like a slot machine, and land back
  // on the right number
  function spin() {
    if (!gc) return;
    var strips = gc.querySelectorAll(".od-s");
    strips.forEach(function (strip, i) {
      var d = Number(strip.dataset.at || 0) % 10;
      strip.style.setProperty("--a", d - 10 + "em");
      strip.style.setProperty("--b", d + "em");
      strip.style.setProperty("--i", i);
    });
    restart(gc, "spin");
    for (var k = 0; k < 9; k++) program.tick(k * 0.07 + k * k * 0.004, gc);
    program.ping(5, 0.95 + strips.length * 0.06, gc);
  }

  // The particles stop where they are while six motes fly out and draw the
  // Gleam hexagon in thin coloured lines, then let it go
  function constellation() {
    overlay = {
      start: null,
      dur: 2.6,
      hold: true,
      draw: function (e) {
        var g = fx.g;
        var ctx = fx.ctx;
        var r = Math.min(90, Math.max(40, Math.min(g.w, g.h) * 0.09));
        var cx = Math.min(g.w - r - 16, Math.max(r + 16, g.tx));
        var cy = Math.max(r + 16, g.ty - g.th * 0.9 - r);
        var fade = 1 - ease((e - 2.1) / 0.5);
        var pts = [];
        for (var k = 0; k < 6; k++) {
          pts.push([cx + r * Math.sin((k * Math.PI) / 3), cy - r * Math.cos((k * Math.PI) / 3)]);
        }
        for (k = 0; k < 6; k++) {
          var m = ease((e - k * 0.07) / 0.7);
          if (m <= 0) continue;
          var x0 = g.bx;
          var y0 = fx.stripeY(k % 5);
          var x = x0 + (pts[k][0] - x0) * m;
          var y = y0 + (pts[k][1] - y0) * m;
          ctx.globalAlpha = fade;
          ctx.fillStyle = COLORS[k % 5];
          ctx.beginPath();
          ctx.arc(x, y, m < 1 ? 2.5 : 3.5, 0, Math.PI * 2);
          ctx.fill();
          var d = ease((e - 0.75 - k * 0.12) / 0.3);
          if (d <= 0) continue;
          var a = pts[k];
          var b = pts[(k + 1) % 6];
          var ex = a[0] + (b[0] - a[0]) * d;
          var ey = a[1] + (b[1] - a[1]) * d;
          fx.line(a[0], a[1], ex, ey, COLORS[k % 5], 10, 0.2 * fade);
          fx.line(a[0], a[1], ex, ey, COLORS[k % 5], 2.5, fade);
        }
        ctx.globalAlpha = 1;
      },
    };
    for (var k = 0; k < 6; k++) program.ping(k, 0.75 + k * 0.12 + 0.15, gc);
    [0, 2, 3].forEach(function (step) {
      program.soft(step, 1.6, gc);
    });
  }

  // Stars open all over the headline, each at its own high pitch, like
  // light catching a stone as it turns
  function glintStorm() {
    var title = document.querySelector(".v-title");
    if (!title) return;
    var seed = Date.now();
    for (var i = 0; i < 9; i++) {
      var star = document.createElement("span");
      star.className = "v-twinkle";
      star.setAttribute("aria-hidden", "true");
      star.style.setProperty("--hit", COLORS[i % 5]);
      star.style.left = 3 + rand(seed + i * 3) * 92 + "%";
      star.style.top = 8 + rand(seed + i * 5) * 80 + "%";
      star.style.fontSize = 1 + rand(seed + i * 7) * 0.8 + "em";
      star.style.animationDelay = i * 0.1 + "s";
      star.addEventListener("animationend", function (ev) {
        ev.currentTarget.remove();
      });
      title.appendChild(star);
      if (i % 3 !== 2) program.ping(5 + Math.floor(rand(seed + i) * 5), 0.4 + i * 0.1, title);
    }
  }

  var MOMENTS = [
    rewind,
    rewindCatchUp,
    fastForward,
    pluck,
    fiveAtOnce,
    cascade,
    spin,
    constellation,
    glintStorm,
  ];
  var nextMoment = deckOf(MOMENTS);
  var quietUntil = 0;
  var returns = 0;

  // The fifth return of a visit, once ever, gets a line instead of a moment
  function echo() {
    var meter = document.querySelector(".v-meter");
    if (!meter) return false;
    try {
      if (localStorage.getItem("gleam:echo")) return false;
      localStorage.setItem("gleam:echo", "1");
    } catch {
      return false;
    }
    var line = document.createElement("p");
    line.className = "v-echo";
    line.textContent = "You keep coming back. Your AO should too.";
    line.addEventListener("animationend", function (ev) {
      if (ev.animationName === "echo") line.remove();
    });
    meter.appendChild(line);
    [0, 2, 3, 5].forEach(function (step, i) {
      program.soft(step, i * 0.12, gc);
    });
    return true;
  }

  function welcomeBack() {
    if (Date.now() < quietUntil || root.classList.contains("gate")) return;
    quietUntil = Date.now() + 3000;
    returns++;
    if (returns === 5 && echo()) return;
    if (!motion || !fx) {
      program.soft(0, 0, gc);
      program.soft(3, 0.12, gc);
      return;
    }
    nextMoment()();
    kick();
  }

  if (hero && "IntersectionObserver" in window) {
    var away = null;
    new IntersectionObserver(
      function (entries) {
        var entry = entries[entries.length - 1];
        if (root.classList.contains("gate")) return;
        if (!entry.isIntersecting) {
          if (away === null) away = Date.now();
          return;
        }
        if (entry.intersectionRatio < 0.5 || away === null) return;
        var gone = Date.now() - away;
        away = null;
        if (gone >= 3000) welcomeBack();
      },
      { threshold: [0, 0.5] },
    ).observe(hero);
  }

  // ---- The gate: the hero, held until it's tapped -------------------------

  var gate = document.querySelector(".v-gate");
  if (gate && root.classList.contains("gate")) holdGate();

  function holdGate() {
    var orb = gate.querySelector(".v-gate-orb");
    var behind = Array.prototype.slice.call(
      document.querySelectorAll("main > :not(.v-hero), .site-footer"),
    );
    behind.forEach(function (el) {
      el.inert = true;
    });
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    window.scrollTo(0, 0);

    // The orb leans a little toward the pointer, as if it's watching. 10px
    // at the screen's edge, matching the CSS.
    var lx = 0;
    var ly = 0;
    function lean(e) {
      var r = gate.getBoundingClientRect();
      lx = (e.clientX - r.left) / r.width - 0.5;
      ly = (e.clientY - r.top) / r.height - 0.5;
      orb.style.setProperty("--lx", lx.toFixed(3));
      orb.style.setProperty("--ly", ly.toFixed(3));
    }

    // The gate is a slot machine with three reels' worth of copy. Each tap
    // spins the reel to the next perk; the third lands and wakes the hero.
    // The first tap is also what unlocks the page's sound.
    var reel = gate.querySelector(".v-reel");
    var strip = gate.querySelector(".v-reel-strip");
    var lamps = gate.querySelectorAll(".v-gate-lamps i");
    var live = document.querySelector("[data-gate-live]");
    var perks = Array.prototype.slice.call(
      gate.querySelector(".v-perks").content.querySelectorAll(".v-reel-item"),
    );
    var pulls = 0;
    var spin = null;

    function pull() {
      if (root.classList.contains("waking") || pulls >= perks.length) return;
      // A tap mid-spin slams the reel home and spins the next, so every tap
      // counts and nobody waits on the animation
      if (spin) spin.land();
      var n = pulls++;
      if (n === 0) program.enableSound();
      if (window.umami) window.umami.track("gleam-gate-" + (n + 1));
      if (motion) restart(orb, "hit");
      spin = spinTo(perks[n], n);
    }

    function spinTo(perk, n) {
      var current = strip.lastElementChild;
      var target = perk.cloneNode(true);
      // A blur of the other perks and GLEAMs between, one more past the
      // target for the landing to overshoot into
      var turns = motion ? 9 + n * 3 : 0;
      var items = [current];
      for (var i = 0; i < turns; i++) {
        var filler = i % 3 === 2 ? perks[(n + i) % perks.length].cloneNode(true) : gleamItem(i);
        items.push(filler);
      }
      items.push(target);
      if (motion) items.push(gleamItem(turns));
      strip.replaceChildren.apply(strip, items);

      var h = reel.offsetHeight;
      var dist = items.indexOf(target);
      var dur = 700 + turns * 45;
      var start = window.performance.now();
      var passed = 0;
      var frame = 0;
      var done = false;

      function at(pos) {
        strip.style.transform = "translateY(" + (-pos * h).toFixed(1) + "px)";
      }
      function step(now) {
        var t = Math.min(1, (now - start) / dur);
        var pos = reelAt(t, dist);
        var v = (reelAt(Math.min(1, t + 0.02), dist) - pos) / 0.02;
        strip.style.filter = v > 4 ? "blur(" + Math.min(4, v / 6).toFixed(1) + "px)" : "";
        at(pos);
        var p = Math.floor(pos + 0.5);
        if (p > passed && p < dist) program.tick(0, reel);
        passed = Math.max(passed, p);
        if (t < 1) frame = requestAnimationFrame(step);
        else land();
      }

      function land() {
        if (done) return;
        done = true;
        cancelAnimationFrame(frame);
        strip.replaceChildren(target);
        strip.style.transform = "";
        strip.style.filter = "";
        target.style.setProperty("--c", COLORS[n * 2]);
        lamps[n].style.setProperty("--c", COLORS[n * 2]);
        lamps[n].classList.add("on");
        if (motion) restart(target, "hit");
        if (live) live.textContent = target.textContent;
        if (spin && spin.land === land) spin = null;
        if (n === perks.length - 1) {
          window.setTimeout(wake, motion ? 650 : 900);
        } else {
          program.ping(n * 2, 0, reel);
          program.soft(n * 2, 0.02, reel);
        }
      }

      if (motion) frame = requestAnimationFrame(step);
      else window.setTimeout(land, 0);
      return { land: land };
    }

    function gleamItem(i) {
      var item = document.createElement("span");
      item.className = "v-reel-item";
      var word = document.createElement("b");
      word.textContent = "GLEAM";
      word.style.color = COLORS[i % COLORS.length];
      item.appendChild(document.createElement("span")).appendChild(word);
      return item;
    }

    // Where the reel sits, in items, t of the way through a spin of dist:
    // it runs a quarter item past its mark, then settles back like it has
    // weight
    function reelAt(t, dist) {
      var over = 0.25;
      if (t < 0.8) {
        var u = 1 - t / 0.8;
        return (dist + over) * (1 - u * u * u);
      }
      var s = (t - 0.8) / 0.2;
      return dist + over * (1 - s * s * (3 - 2 * s));
    }

    // The nav stays usable, so only Enter or Space with nothing else focused
    function onKey(e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (document.activeElement && document.activeElement !== document.body &&
          document.activeElement !== gate) return;
      e.preventDefault();
      pull();
    }

    gate.addEventListener("pointermove", lean);
    gate.addEventListener("click", pull);
    document.addEventListener("keydown", onKey);

    function wake() {
      if (root.classList.contains("waking")) return;
      gate.removeEventListener("pointermove", lean);
      document.removeEventListener("keydown", onKey);

      // Fly the orb so its 0 lands on the counter's 0. The orb scales about
      // its own centre, so the 0's offset from that centre scales with it.
      var box = orb.getBoundingClientRect();
      var zero = gate.querySelector(".v-gate-num b").getBoundingClientRect();
      var to = document.querySelector(".gc-num").getBoundingClientRect();
      var k = to.height / zero.height;
      var cx = box.left + box.width / 2 - lx * 10;
      var cy = box.top + box.height / 2 - ly * 10;
      var zx = zero.left + zero.width / 2 - lx * 10;
      var zy = zero.top + zero.height / 2 - ly * 10;
      root.classList.add("waking");
      if (motion) {
        orb.style.translate =
          to.left + to.width / 2 - cx - k * (zx - cx) + "px " +
          (to.top + to.height / 2 - cy - k * (zy - cy)) + "px";
        orb.style.scale = String(k);
      }

      // The rings burst up the scale as GLEAM scatters, then a low swell as
      // the orb lands and the count begins
      program.enableSound(function () {
        program.soft(0, 0);
        [0, 1, 2, 3, 4].forEach(function (step, i) {
          program.ping(step, i * 0.06);
        });
        program.ping(5, 0.95);
      });

      window.setTimeout(function () {
        root.classList.remove("gate", "waking");
        behind.forEach(function (el) {
          el.inert = false;
        });
        if (gate.contains(document.activeElement)) document.activeElement.blur();
        if (fx) fx.measure();
        if (gc && motion) restart(gc, "land");
        kick();
      }, motion ? 1300 : 300);
    }
  }

  // Scrolling in the hero drives its clock: a brisk scroll up runs time
  // backwards, down runs it forwards and fast. A slow scroll barely moves it.
  var lastScroll = { y: window.scrollY, t: 0 };

  function scrubTime() {
    var t = window.performance.now();
    var dt = t - lastScroll.t;
    var dy = window.scrollY - lastScroll.y;
    lastScroll = { y: window.scrollY, t: t };
    if (!motion || !seen.hero || overlay || root.classList.contains("gate")) return;
    if (dt <= 0 || dt > 250) return;
    // px/ms: 2 is a brisk flick, worth 10x either way
    var target = Math.max(-10, Math.min(10, 1 + (5 * dy) / dt));
    scrub = scrub * 0.5 + target * 0.5;
    kick();
  }

  function onScroll() {
    trackScroll();
    updateAngles();
    requestTimeline();
    updateLines(true);
    updateRows(true);
    updatePrism();
    updateStakeHead();
    updateSteps(true);
    updateConvert();
    updateChoices(true);
    updateArcs(true);
    scrubTime();
  }

  function onResize() {
    if (fx) fx.measure();
    layoutTimeline();
    updateLines();
    updateRows();
    updateChoices();
    updateSteps();
    updateArcs();
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(onResize);
  layoutTimeline();
  updateLines();
  updateRows();
  updateChoices();
  updateArcs();

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
