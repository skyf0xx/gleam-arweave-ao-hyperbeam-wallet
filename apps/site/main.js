(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Reveal each section once, the first time it enters the viewport.
  var sections = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reducedMotion.matches) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });
    sections.forEach(function (section) { observer.observe(section); });
  } else {
    sections.forEach(function (section) { section.classList.add("in"); });
  }

  // Story: the step whose text has crossed the reference line drives the pinned card.
  // --p is that step's progress past the line, 0 to 1; data-phase splits a step in two.
  var stage = document.querySelector(".stage");
  var card = stage && stage.querySelector(".card");
  var steps = Array.prototype.slice.call(document.querySelectorAll(".story .step"));
  var oneColumn = window.matchMedia("(max-width: 900px)");
  var phaseAt = { 1: 0.35, 2: 0.45, 3: 0.4 };
  var storyFrame = null;
  var lastStep = null;

  function updateStory() {
    storyFrame = null;
    var vh = window.innerHeight;
    // A step counts once its text rises past the line: just past centre with two columns,
    // or on entering the band below the pinned card with one
    var line = vh * (oneColumn.matches ? 0.85 : 0.55);
    var active = 0;
    var progress = 0;
    steps.forEach(function (step, i) {
      var top = step.querySelector(".reveal-text").getBoundingClientRect().top;
      if (i === 0 || top <= line) {
        active = i;
        progress = Math.min(1, Math.max(0, (line - top) / Math.max(step.offsetHeight, 1)));
      }
    });
    stage.dataset.step = active;
    stage.dataset.phase = phaseAt[active] !== undefined && progress >= phaseAt[active] ? "1" : "0";
    var fill = active === 2 ? Math.min(1, progress / phaseAt[2]) : 0;
    card.style.setProperty("--p", fill.toFixed(3));
    if (lastStep !== null && active !== lastStep && !reducedMotion.matches) {
      card.classList.remove("sweep");
      void card.offsetWidth;
      card.classList.add("sweep");
    }
    lastStep = active;
  }

  function requestStory() {
    if (storyFrame === null) storyFrame = requestAnimationFrame(updateStory);
  }

  if (stage && card) {
    card.addEventListener("animationend", function () { card.classList.remove("sweep"); });
    window.addEventListener("scroll", requestStory, { passive: true });
    window.addEventListener("resize", requestStory);
    updateStory();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { stage.classList.add("loaded"); });
    });

    // The balance counts up from zero as the chart draws in
    var amount = card.querySelector("[data-count]");
    if (amount && !reducedMotion.matches) {
      var total = parseFloat(amount.dataset.count);
      var start = null;
      var countUp = function (now) {
        if (start === null) start = now;
        var t = Math.min(1, (now - start - 300) / 1500);
        var eased = t <= 0 ? 0 : 1 - Math.pow(1 - t, 3);
        amount.textContent = "$" + (total * eased).toFixed(2);
        if (t < 1) requestAnimationFrame(countUp);
      };
      requestAnimationFrame(countUp);
    }
  }

  // Refraction line: follows the cursor by up to ±6px, eased.
  var line = document.querySelector(".refraction");
  var finePointer = window.matchMedia("(pointer: fine)");
  var target = { x: 0, y: 0 };
  var current = { x: 0, y: 0 };
  var frame = null;

  function step() {
    current.x += (target.x - current.x) * 0.06;
    current.y += (target.y - current.y) * 0.06;
    line.style.setProperty("--rx", current.x.toFixed(2) + "px");
    line.style.setProperty("--ry", current.y.toFixed(2) + "px");
    if (Math.abs(target.x - current.x) > 0.01 || Math.abs(target.y - current.y) > 0.01) {
      frame = requestAnimationFrame(step);
    } else {
      frame = null;
    }
  }

  function onPointerMove(event) {
    if (reducedMotion.matches || document.hidden) return;
    target.x = (event.clientX / window.innerWidth - 0.5) * 12;
    target.y = (event.clientY / window.innerHeight - 0.5) * 12;
    if (frame === null) frame = requestAnimationFrame(step);
  }

  if (line && finePointer.matches) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
  }

  document.addEventListener("visibilitychange", function () {
    root.classList.toggle("paused", document.hidden);
    if (document.hidden && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  });

  reducedMotion.addEventListener("change", function () {
    if (reducedMotion.matches) {
      target.x = target.y = current.x = current.y = 0;
      if (line) {
        line.style.removeProperty("--rx");
        line.style.removeProperty("--ry");
      }
    }
  });
})();
