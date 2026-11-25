// The hero particles.
import { COLORS, PPS } from "./context.js";

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

export function rand(seed) {
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

export var fx = null;
export var hero = document.querySelector(".v-hero");
export var canvas = document.querySelector(".v-canvas");

export function createFx() {
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

export function setFx(v) {
  fx = v;
}
