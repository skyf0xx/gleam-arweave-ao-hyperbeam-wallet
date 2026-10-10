// points.html. Every moving part maps to a rule in POINTS.md § Rules: the dial
// is today filling up to the daily count at 00:00 UTC, the scoreboard rolls to
// the calculator's estimate, the invite pulse is the bonus paid to both sides,
// and the chart plots the whale curve with your balance on it.
(function () {
  "use strict";

  var program = window.GleamProgram;
  var format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  var DAY = 86400000;

  function curve(balance) {
    return balance <= 100 ? balance : 2 * Math.sqrt(100 * balance) - 100;
  }

  function onScreen(el, cb) {
    if (!("IntersectionObserver" in window)) {
      cb(true);
      return;
    }
    new IntersectionObserver(function (entries) {
      cb(entries[entries.length - 1].isIntersecting);
    }).observe(el);
  }

  // ---- Dial: time to the next daily count ------------------------------

  var dial = document.querySelector("[data-dial]");
  var dialTime = document.querySelector("[data-dial-time]");
  var dialSeen = false;
  var dialTimer = 0;
  var lastLeft = null;

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function tickDial() {
    var now = Date.now();
    var into = ((now % DAY) + DAY) % DAY;
    var left = DAY - into;
    dial.style.setProperty("--p", (into / DAY).toFixed(5));
    var s = Math.floor(left / 1000);
    dialTime.textContent = pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);
    // The count just happened: the day wrapped back to a full turn
    if (lastLeft !== null && left > lastLeft) {
      if (program.motion()) program.restart(dial, "land");
      program.ping(9);
      program.ping(12, 0.12);
    }
    lastLeft = left;
  }

  function runDial() {
    var want = dialSeen && !document.hidden;
    if (want && !dialTimer) {
      tickDial();
      dialTimer = window.setInterval(tickDial, 1000);
    } else if (!want && dialTimer) {
      window.clearInterval(dialTimer);
      dialTimer = 0;
      lastLeft = null;
    }
  }

  if (dial) {
    tickDial();
    onScreen(dial, function (seen) {
      dialSeen = seen;
      runDial();
    });
    document.addEventListener("visibilitychange", runDial);
  }

  // ---- Stats roll in from zero the first time they're on screen --------

  var stats = document.querySelector(".points-stats");
  if (stats && program.motion()) {
    var rolls = Array.prototype.slice.call(stats.querySelectorAll("[data-roll]"));
    var counters = rolls.map(function (el) {
      var target = Number(el.getAttribute("data-roll"));
      el.textContent = "";
      el.setAttribute("aria-label", (el.getAttribute("data-prefix") || "") + target + (el.getAttribute("data-suffix") || ""));
      if (el.getAttribute("data-prefix")) el.appendChild(document.createTextNode(el.getAttribute("data-prefix")));
      var digits = document.createElement("span");
      digits.className = "gc-int";
      digits.setAttribute("aria-hidden", "true");
      el.appendChild(digits);
      if (el.getAttribute("data-suffix")) el.appendChild(document.createTextNode(el.getAttribute("data-suffix")));
      // Zero-padded to the final width, so +00% rolls to +10% without reflowing
      var od = program.odometer(digits, null, String(target).length);
      return { el: el, od: od, target: target };
    });
    stats.addEventListener("reveal", function () {
      counters.forEach(function (c, i) {
        window.setTimeout(function () {
          c.od.set(c.target);
          window.setTimeout(function () {
            c.el.style.setProperty("--hit", program.COLORS[[2, 0, 3][i]]);
            program.restart(c.el, "land");
            program.ping([0, 2, 4][i]);
          }, 480);
        }, 260 + i * 240);
      });
    });
  }

  // ---- Scoreboard: the calculator's estimate, rolled and broken down ---

  var form = document.querySelector("form[data-points-calc]");
  var scores = {};
  var mix = {};
  var settle = 0;

  function renderEstimate(e, land) {
    var day = e.perDay;
    var values = { day: day, month: day * 30, year: day * 365 };
    Object.keys(scores).forEach(function (key) {
      scores[key].od.set(Math.round(values[key]));
    });
    var total = e.hold + e.bonus + e.friends;
    [["hold", e.hold], ["bonus", e.bonus], ["friends", e.friends]].forEach(function (pair) {
      var part = mix.parts[pair[0]];
      var share = total > 0 ? pair[1] / total : 0;
      part.style.setProperty("--w", share.toFixed(4));
      part.style.display = share > 0 ? "" : "none";
      mix.vals[pair[0]].textContent = format.format(Math.round(pair[1]));
    });
    if (curveChart) curveChart.mark(e.held);
    if (!land) return;
    window.clearTimeout(settle);
    settle = window.setTimeout(function () {
      var year = scores.year;
      if (!year) return;
      if (program.motion()) program.restart(year.el, "land");
      program.ping(Math.round(Math.log10(values.year + 1) * 1.6));
    }, 380);
  }

  // ---- Whale curve chart -----------------------------------------------

  var curveChart = null;
  var figure = document.querySelector("[data-curve]");

  function niceMax(v) {
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  function shortNum(v) {
    if (v >= 1000000) return format.format(v / 1000000) + "M";
    if (v >= 10000) return format.format(v / 1000) + "k";
    return format.format(v);
  }

  function createCurve(fig) {
    var plot = fig.querySelector(".curve-plot");
    var ns = "http://www.w3.org/2000/svg";
    var held = 0;
    var geo = null;
    var tip = document.createElement("div");
    tip.className = "curve-tip";
    tip.setAttribute("aria-hidden", "true");

    function el(name, attrs, parent) {
      var node = document.createElementNS(ns, name);
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      if (parent) parent.appendChild(node);
      return node;
    }

    function draw() {
      var w = Math.max(260, plot.clientWidth);
      var h = Math.round(Math.min(320, Math.max(220, w * 0.58)));
      var m = { t: 16, r: 18, b: 30, l: 44 };
      var xMax = niceMax(Math.max(1000, held * 1.3));
      var yMax = niceMax(curve(xMax) * 1.25);
      var iw = w - m.l - m.r;
      var ih = h - m.t - m.b;
      var x = function (v) { return m.l + (v / xMax) * iw; };
      var y = function (v) { return m.t + ih - (v / yMax) * ih; };
      geo = { x: x, y: y, xMax: xMax, m: m, iw: iw };

      plot.textContent = "";
      var svg = el("svg", { viewBox: "0 0 " + w + " " + h, width: w, height: h, "aria-hidden": "true" });
      var defs = el("defs", {}, svg);
      var clip = el("clipPath", { id: "curve-clip" }, defs);
      el("rect", { x: m.l, y: m.t, width: iw, height: ih }, clip);

      var grid = el("g", { class: "curve-grid" }, svg);
      var axis = el("g", { class: "curve-axis" }, svg);
      for (var i = 0; i <= 4; i++) {
        var yv = (yMax / 4) * i;
        el("line", { x1: m.l, x2: m.l + iw, y1: y(yv), y2: y(yv) }, grid);
        el("text", { x: m.l - 8, y: y(yv) + 4, "text-anchor": "end" }, axis).textContent = shortNum(yv);
        var xv = (xMax / 4) * i;
        el("text", { x: x(xv), y: h - 8, "text-anchor": i === 0 ? "start" : i === 4 ? "end" : "middle" }, axis).textContent = shortNum(xv);
      }

      var plotG = el("g", { "clip-path": "url(#curve-clip)" }, svg);
      el("line", { class: "curve-ref", x1: x(0), y1: y(0), x2: x(yMax), y2: y(yMax) }, plotG);
      var d = "";
      for (var s = 0; s <= 120; s++) {
        var b = (xMax / 120) * s;
        d += (s ? "L" : "M") + x(b).toFixed(1) + "," + y(curve(b)).toFixed(1);
      }
      el("path", { class: "curve-line", d: d }, plotG);

      // Direct labels: the series at its end, the 1:1 line beside its upper reach
      el("text", { class: "curve-label", x: m.l + iw - 4, y: y(curve(xMax)) - 10, "text-anchor": "end" }, svg).textContent = "Gleam Points";
      var refAt = Math.min(yMax, xMax) * 0.78;
      var refLabel = el("text", { class: "curve-label ref", x: x(refAt) + 10, y: y(refAt) + 4 }, svg);
      refLabel.textContent = "1 point per AR or AO";

      if (held > 0) {
        var you = el("g", { class: "curve-you" }, svg);
        var hx = x(Math.min(held, xMax));
        var hy = y(curve(Math.min(held, xMax)));
        el("line", { x1: hx, x2: hx, y1: hy, y2: m.t + ih }, you);
        el("circle", { cx: hx, cy: hy, r: 7 }, you);
        el("circle", { cx: hx, cy: hy, r: 4.5 }, you);
        var right = hx > m.l + iw * 0.6;
        el("text", { x: hx + (right ? -12 : 12), y: hy + 20, "text-anchor": right ? "end" : "start" }, you).textContent =
          "You: " + format.format(Math.round(curve(held))) + " a day";
      }

      var hair = el("line", { class: "curve-hair", y1: m.t, y2: m.t + ih }, svg);
      var dot = el("circle", { class: "curve-dot", r: 5 }, svg);
      var hit = el("rect", { class: "curve-hit", x: m.l, y: 0, width: iw, height: h }, svg);
      geo.hair = hair;
      geo.dot = dot;

      hit.addEventListener("pointermove", hover);
      hit.addEventListener("pointerdown", hover);
      hit.addEventListener("pointerleave", function () { plot.classList.remove("hover"); });
      plot.appendChild(svg);
      plot.appendChild(tip);
    }

    function hover(e) {
      var box = plot.getBoundingClientRect();
      var px = e.clientX - box.left;
      var b = Math.max(0, Math.min(geo.xMax, ((px - geo.m.l) / geo.iw) * geo.xMax));
      var pts = curve(b);
      var cx = geo.x(b);
      var cy = geo.y(pts);
      geo.hair.setAttribute("x1", cx);
      geo.hair.setAttribute("x2", cx);
      geo.dot.setAttribute("cx", cx);
      geo.dot.setAttribute("cy", cy);
      tip.innerHTML = "";
      var line1 = document.createElement("b");
      line1.textContent = format.format(Math.round(b)) + " AR + AO";
      tip.appendChild(line1);
      tip.appendChild(document.createElement("br"));
      tip.appendChild(document.createTextNode(format.format(Math.round(pts)) + " points a day"));
      var half = 70;
      tip.style.left = Math.max(half, Math.min(box.width - half, cx)) + "px";
      tip.style.top = cy + "px";
      plot.classList.add("hover");
    }

    var redraw = 0;
    function mark(balance) {
      held = balance;
      window.cancelAnimationFrame(redraw);
      redraw = window.requestAnimationFrame(draw);
    }

    window.addEventListener("resize", function () { mark(held); });
    draw();
    return { mark: mark };
  }

  if (figure) curveChart = createCurve(figure);

  if (form) {
    ["day", "month", "year"].forEach(function (key) {
      var el = form.querySelector('[data-od="' + key + '"]');
      if (!el) return;
      var digits = document.createElement("span");
      digits.className = "gc-int";
      el.appendChild(digits);
      scores[key] = { el: el, od: program.odometer(digits) };
    });
    mix.parts = {};
    mix.vals = {};
    ["hold", "bonus", "friends"].forEach(function (key) {
      mix.parts[key] = form.querySelector('[data-mix-part="' + key + '"]');
      mix.vals[key] = form.querySelector('[data-mix-val="' + key + '"]');
    });
    form.addEventListener("estimate", function () { renderEstimate(form.gleamEstimate, true); });
    if (form.gleamEstimate) renderEstimate(form.gleamEstimate, false);
  }

  // ---- Referral pulse, only while it's on screen -----------------------

  var ref = document.querySelector('[data-gate="ref"]');
  if (ref) {
    onScreen(ref, function (seen) {
      ref.classList.toggle("live", seen && program.motion());
    });
    // A soft two-note ping as each side's bonus lands: friend, then you
    [["friend", 2], ["you", 4]].forEach(function (pair) {
      var value = ref.querySelector('[data-ref-side="' + pair[0] + '"] .referral-value');
      var play = function () { if (!document.hidden) program.ping(pair[1]); };
      value.addEventListener("animationstart", play);
      value.addEventListener("animationiteration", play);
    });
  }

  // ---- How it works: the beam fills as each step crosses the reading line

  var steps = document.querySelector("[data-steps]");
  var stepItems = steps ? Array.prototype.slice.call(steps.children) : [];
  var stepFrame = null;

  function updateSteps() {
    stepFrame = null;
    if (!program.motion()) return;
    var mark = window.innerHeight * 0.62;
    var box = steps.getBoundingClientRect();
    var fill = Math.min(1, Math.max(0, (mark - box.top - 40) / Math.max(1, box.height - 80)));
    steps.style.setProperty("--fill", fill.toFixed(3));
    stepItems.forEach(function (li) {
      li.classList.toggle("lit", li.getBoundingClientRect().top + 40 < mark);
    });
  }

  if (steps) {
    window.addEventListener("scroll", function () {
      if (stepFrame === null) stepFrame = window.requestAnimationFrame(updateSteps);
    }, { passive: true });
    updateSteps();
  }

  program.reveal(document.querySelectorAll(".reveal"));
})();
