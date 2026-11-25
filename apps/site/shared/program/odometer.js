import { motion } from "./core.js";
// import { motion } from "./core.js";

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
export function odometer(el, onGrow, width) {
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
