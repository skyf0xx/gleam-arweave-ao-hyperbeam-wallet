// invite.html's close: GLEAM on the end of the beam, linking to gleam.html.
// A point rides the beam into the word now and then. Hovering, or scrolling
// with it on screen, showers shards off the arrowhead into the letters, drawn
// the way gleam.html's hero draws them. A tap flattens the word into the beam,
// fires the beam off the right edge and cuts to black, so gleam.html's gate
// can open on the beam arriving from the left.
(function () {
  "use strict";

  var program = window.GleamProgram;
  var pad = document.querySelector("[data-launch-pad]");
  if (!pad || !program) return;

  var link = pad.querySelector("[data-launch]");
  var beam = pad.querySelector(".i-launch-beam");
  var pulse = beam.querySelector("i");
  var tip = pad.querySelector(".i-launch-tip");
  var word = pad.querySelector(".i-launch-word");
  var letters = Array.prototype.slice.call(word.children);
  var streak = pad.querySelector(".i-launch-streak");
  var canvas = pad.querySelector(".i-launch-sparks");
  var black = document.querySelector(".i-launch-black");
  var ctx = canvas.getContext && canvas.getContext("2d");
  var COLORS = program.COLORS;

  var armed = false;
  var busy = false;
  var onScreen = false;

  // ---- The idle pulse ------------------------------------------------------

  // Not while hovering: the wave is colouring the letters then
  function glint() {
    if (armed) return;
    program.restart(word, "glint");
  }

  function firePulse() {
    if (!program.motion() || busy || !onScreen || !pulse.animate) return;
    var w = beam.getBoundingClientRect().width;
    var run = pulse.animate(
      [
        { transform: "translateX(0)", opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { transform: "translateX(" + w + "px)", opacity: 1 },
      ],
      { duration: 1000, easing: "cubic-bezier(.55, 0, .9, .6)" },
    );
    run.onfinish = glint;
  }
  // The gate's 3.2s cycle, so both pages keep the same beat
  window.setInterval(firePulse, 3200);

  // ---- Shards --------------------------------------------------------------

  var shards = [];
  var raf = 0;
  var lastSpawn = 0;
  var scrollUntil = 0;
  var scrollRate = 0;
  var dpr = 1;
  var geo = null;
  var measuredAt = 0;

  function bez(a, b, c, d, t) {
    var u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  }

  function measure() {
    var p = pad.getBoundingClientRect();
    var t = tip.getBoundingClientRect();
    var b = beam.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(p.width * dpr);
    var h = Math.round(p.height * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    measuredAt = window.performance.now();
    geo = {
      x0: t.left - p.left + 18,
      by: b.top - p.top,
      bh: b.height,
      letters: letters.map(function (el) {
        var r = el.getBoundingClientRect();
        return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height };
      }),
    };
  }

  // Most shards land on the first letters; a few carry further along the word
  function spawn(now) {
    var s = Math.floor(Math.random() * 5);
    var y0 = geo.by + ((s + 0.5) * geo.bh) / 5;
    var reach = Math.random() < 0.3 ? letters.length : 2;
    var li = Math.floor(Math.random() * reach);
    var box = geo.letters[li];
    var x3 = box.x + box.w * (0.2 + Math.random() * 0.6);
    var y3 = box.y + box.h * (0.2 + Math.random() * 0.6);
    shards.push({
      s: s,
      letter: li,
      born: now,
      life: 650 + Math.random() * 600,
      p: [
        geo.x0, y0,
        geo.x0 + 30 + Math.random() * 60, y0 + (Math.random() - 0.6) * 120,
        x3 - 20 + (Math.random() - 0.5) * 80, y3 + (Math.random() - 0.5) * box.h,
        x3, y3,
      ],
    });
  }

  // Only some landings tint a letter, and a lit letter is left to fade, so
  // the word warms a little rather than flashing
  var litAt = letters.map(function () { return 0; });
  function land(sh, now) {
    if (armed || Math.random() > 0.3 || now - litAt[sh.letter] < 700) return;
    litAt[sh.letter] = now;
    // A transition rather than an animation, so it leaves the hover wave be
    var el = letters[sh.letter].querySelector("b");
    if (!el) return;
    el.style.transition = "none";
    el.style.color = "color-mix(in oklab, " + COLORS[sh.s] + " 22%, transparent)";
    void el.offsetWidth;
    el.style.transition = "color 1.1s ease-out";
    el.style.color = "";
  }

  function line(color, x0, y0, x1, y1, width, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function frame(now) {
    var showering = (armed || now < scrollUntil) && !busy;
    // The layout can move under a running shower (a resize, the page
    // reflowing), so the arrow's place is re-read while shards are flowing
    if (showering && now - measuredAt > 250) measure();
    if (showering && now - lastSpawn > 28) {
      var n = armed ? 2 : Math.max(1, Math.round(scrollRate));
      for (var i = 0; i < n; i++) spawn(now);
      lastSpawn = now;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    shards = shards.filter(function (sh) {
      var t = (now - sh.born) / sh.life;
      if (t >= 1) {
        land(sh, now);
        return false;
      }
      var e = 1 - (1 - t) * (1 - t);
      var e0 = 1 - Math.pow(1 - Math.max(0, t - 0.12), 2);
      var p = sh.p;
      var ax = bez(p[0], p[2], p[4], p[6], e0);
      var ay = bez(p[1], p[3], p[5], p[7], e0);
      var bx = bez(p[0], p[2], p[4], p[6], e);
      var by = bez(p[1], p[3], p[5], p[7], e);
      var a = 1 - t * t;
      // A wide faint pass under a thin bright one reads as glow, as in the hero
      line(COLORS[sh.s], ax, ay, bx, by, 6.4, a * 0.18);
      line(COLORS[sh.s], ax, ay, bx, by, 1.8, a);
      return true;
    });
    ctx.globalAlpha = 1;
    raf = showering || shards.length ? window.requestAnimationFrame(frame) : 0;
  }

  function run() {
    if (raf || !ctx || !program.motion()) return;
    measure();
    raf = window.requestAnimationFrame(frame);
  }

  window.addEventListener("resize", function () {
    if (raf) measure();
  });

  // Scrolling past the word showers it too, harder the faster you go, which
  // is how a phone without hover sees it
  var lastY = window.scrollY;
  window.addEventListener("scroll", function () {
    var dy = Math.abs(window.scrollY - lastY);
    lastY = window.scrollY;
    if (!onScreen || busy) return;
    scrollRate = Math.min(3, dy / 12);
    scrollUntil = window.performance.now() + 160;
    run();
  }, { passive: true });

  if ("IntersectionObserver" in window) {
    new window.IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
    }).observe(pad);
  } else {
    onScreen = true;
  }

  // ---- Hover ---------------------------------------------------------------

  function arm(on) {
    if (busy) return;
    armed = on;
    link.classList.toggle("armed", on && program.motion());
    if (on) run();
  }
  link.addEventListener("pointerenter", function (e) {
    if (e.pointerType === "mouse") arm(true);
  });
  link.addEventListener("pointerleave", function () { arm(false); });
  link.addEventListener("focus", function () { arm(true); });
  link.addEventListener("blur", function () { arm(false); });

  // gleam.html is where this link goes nearly every time, so warm it once the
  // word is close
  var warmed = false;
  function warm() {
    if (warmed || !window.fetch) return;
    warmed = true;
    ["/gleam.html", "/gleam/gleam.css", "/gleam/gleam.js"].forEach(function (url) {
      window.fetch(url, { priority: "low" }).catch(function () {});
    });
  }
  if ("IntersectionObserver" in window) {
    var near = new window.IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      near.disconnect();
      warm();
    }, { rootMargin: "50% 0px" });
    near.observe(pad);
  }

  // ---- Launch --------------------------------------------------------------

  function wait(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function anim(el, frames, options) {
    return el.animate(frames, Object.assign({ fill: "forwards" }, options));
  }

  function launch() {
    busy = true;
    armed = false;
    link.classList.remove("armed");
    var href = link.href;

    var p = pad.getBoundingClientRect();
    var w = word.getBoundingClientRect();
    var b = beam.getBoundingClientRect();
    streak.style.top = b.top - p.top + "px";
    var ease = "cubic-bezier(.6, 0, .9, .4)";
    var away = "cubic-bezier(.7, 0, 1, .5)";

    // A rising run of glass pings across the launch: a sparkle, not a hit.
    // Raised past the page's quiet note level, as the gate's tap is. Leaving
    // the page stops its audio, and a phone can take a few hundred ms to start
    // a fresh audio stream, so the cut to gleam.html waits for the run to ring.
    var rung = wait(1300);
    program.enableSound(function () {
      program.loud(function () {
        [2, 4, 7, 9, 12, 14].forEach(function (step, i) {
          program.ping(step, i * 0.11);
        });
      }, 0.5);
    });

    // A breath in
    anim(word, [{ scale: "1" }, { scale: ".94 1.04" }], { duration: 260, easing: "cubic-bezier(.3, 0, .3, 1)" })
      .finished.then(function () {
        // The word flattens into the beam, and the beam runs on through it
        anim(word, [
          { scale: ".94 1.04", opacity: 1 },
          { scale: "1.08 .06", opacity: 1, offset: 0.7 },
          { scale: "1.1 0", opacity: 0 },
        ], { duration: 200, easing: ease });
        anim(tip, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
        streak.style.opacity = "1";
        var left = w.left - p.left;
        return anim(streak, [
          { clipPath: "inset(0 " + (p.width - (w.right - p.left)) + "px 0 " + left + "px)" },
          { clipPath: "inset(0 0 0 " + left + "px)" },
        ], { duration: 200, easing: ease }).finished.then(function () { return left; });
      })
      .then(function (left) {
        // Off the right edge, its tail sweeping after it
        anim(beam, [{ clipPath: "inset(0)" }, { clipPath: "inset(0 0 0 100%)" }], { duration: 320, easing: away });
        anim(streak, [
          { clipPath: "inset(0 0 0 " + left + "px)" },
          { clipPath: "inset(0 0 0 " + p.width + "px)" },
        ], { duration: 380, easing: away });
        return wait(340);
      })
      .then(function () {
        return Promise.all([anim(black, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 }).finished, rung]);
      })
      .then(function () {
        window.location.href = href;
      });
  }

  // Tracked here, not with data-umami-event: Umami's click hook cancels the
  // click and follows the link itself once the event is sent, which would
  // skip the launch. The data-umami-event-* tags pages.js adds still ride along.
  function track() {
    if (!window.umami) return;
    var data = {};
    Array.prototype.forEach.call(link.attributes, function (a) {
      var m = /^data-umami-event-(.+)$/.exec(a.name);
      if (m) data[m[1]] = a.value;
    });
    window.umami.track(link.getAttribute("data-launch-event"), data);
  }

  link.addEventListener("click", function (e) {
    track();
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!program.motion() || !link.animate) return;
    e.preventDefault();
    if (!busy) launch();
  });

  // Back from gleam.html restores this page from the back/forward cache as it
  // was left: flattened and black. Put it back on the pad.
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted || !busy) return;
    [word, tip, beam, streak, black].forEach(function (el) {
      el.getAnimations().forEach(function (a) { a.cancel(); });
    });
    streak.style.opacity = "";
    busy = false;
  });
})();
