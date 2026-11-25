// Stake cards.
import { COLORS, program } from "./context.js";
import { deckOf, effect, flavour } from "./flavours.js";
import { scrollDir } from "./scroll-air.js";

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
