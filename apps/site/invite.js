// invite.html. pages.js decides the state (code, ready, full or none) and fills
// the seats; this draws that state onto the ticket. Nothing here is decorative:
// the code resolving is your code arriving, each seat is a real seat on it, and
// the stamp is what happened to it.
(function () {
  "use strict";

  var program = window.GleamProgram;
  var ticket = document.querySelector("[data-ticket]");
  if (!ticket) return;

  var codeEl = ticket.querySelector("[data-ticket-code]");
  var seatsEl = ticket.querySelector("[data-ticket-seats]");
  var stampEl = ticket.querySelector("[data-ticket-stamp]");
  var codeValue = document.querySelector("[data-invite-code-value]");
  var seats = document.querySelector("[data-seats]");
  var notFound = document.querySelector("[data-not-found]");
  var ready = document.querySelector("[data-invite-ready]");
  var states = {};
  document.querySelectorAll("[data-state]").forEach(function (el) {
    states[el.getAttribute("data-state")] = el;
  });

  var GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var shownCode = null;
  var spinTimer = 0;
  var look = null;

  function setChars(text, cls) {
    codeEl.textContent = "";
    text.split("").forEach(function (ch) {
      var span = document.createElement("span");
      span.textContent = ch;
      if (cls) span.className = cls;
      codeEl.appendChild(span);
    });
  }

  // Slot-machine resolve: every character spins, then they lock left to right
  function resolve(code) {
    window.clearInterval(spinTimer);
    if (!program.motion()) {
      setChars(code);
      return;
    }
    setChars(code.replace(/./g, "0"), "spin");
    var cells = Array.prototype.slice.call(codeEl.children);
    var locked = 0;
    var started = Date.now();
    spinTimer = window.setInterval(function () {
      var due = Math.floor((Date.now() - started - 420) / 85);
      while (locked < cells.length && locked <= due) {
        var cell = cells[locked];
        cell.textContent = code.charAt(locked);
        cell.className = "lock";
        cell.style.setProperty("--hit", program.colorFor(locked + 1));
        program.ping(locked % 5);
        locked++;
      }
      for (var i = locked; i < cells.length; i++) {
        cells[i].textContent = GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
      }
      if (locked >= cells.length) window.clearInterval(spinTimer);
    }, 45);
  }

  function drawSeats() {
    seatsEl.textContent = "";
    if (!seats || seats.hidden || look === "empty" || look === "void") return;
    var left = Number(seats.getAttribute("data-left"));
    var total = Number(seats.getAttribute("data-total")) || Math.min(left, 12);
    if (!(left >= 0) || !total) return;
    for (var i = 0; i < total; i++) {
      var seat = document.createElement("i");
      if (i < left) {
        seat.className = "open";
        seat.style.setProperty("--c", program.colorFor(i + 1));
        seat.style.setProperty("--i", String(i));
      }
      seatsEl.appendChild(seat);
    }
  }

  function stamp(text, burst) {
    stampEl.textContent = text;
    ticket.classList.remove("stamped");
    if (!text) return;
    if (program.motion()) {
      program.restart(ticket, "stamped");
      if (burst) program.restart(ticket, "burst");
    } else {
      ticket.classList.add("stamped");
    }
    if (burst) {
      program.ping(7);
      program.ping(9, 0.09);
      program.ping(12, 0.18);
    }
  }

  function render() {
    var code = codeValue && codeValue.textContent.trim();
    var next;
    if (ready && !ready.hidden) next = "ready";
    else if (states.full && !states.full.hidden) next = "full";
    else if (states.none && !states.none.hidden) next = notFound && !notFound.hidden ? "void" : "empty";
    else if (states.code && !states.code.hidden) next = "code";
    else return;

    if (next !== look) {
      look = next;
      ticket.setAttribute("data-look", look);
      if (look === "empty") {
        window.clearInterval(spinTimer);
        shownCode = null;
        codeEl.classList.add("empty");
        setChars("------");
      } else {
        codeEl.classList.remove("empty");
        codeEl.classList.toggle("void", look === "void");
        if (code && code !== shownCode) {
          shownCode = code;
          resolve(code);
        }
      }
      if (look === "ready") stamp("In Gleam", true);
      else if (look === "full") stamp("Full");
      else if (look === "void") stamp("Not found");
      else stamp("");
    }
    drawSeats();
  }

  var watched = [ready, seats, notFound].concat(Object.keys(states).map(function (k) { return states[k]; }));
  var observer = new window.MutationObserver(render);
  watched.forEach(function (el) {
    if (el) observer.observe(el, { attributes: true, attributeFilter: ["hidden", "data-left"] });
  });
  render();
})();
