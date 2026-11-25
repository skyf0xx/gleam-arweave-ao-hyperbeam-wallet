// gleam.html, the Vision page. One clock drives everything: an example wallet
// holding 250 AO earns 250 points a day (POINTS.md § Rules), sped up 120×, so a
// whole point lands every 2.88s. The counters, the hero particles, the
// signals in "You earn GLEAM by" and the ping all read that clock, and it
// only runs while a counter or signal is on screen and the tab is visible.
// Each section is a module; they run in page order.
import "./context.js";
import "./counters.js";
import "./particles.js";
import "./flavours.js";
import "./timeline.js";
import "./launch.js";
import "./wallet.js";
import "./signals.js";
import "./convert.js";
import "./arcs.js";
import "./scroll-air.js";
import "./angles.js";
import "./stake-cards.js";
import "./tokenomics.js";
import "./fee-loop.js";
import "./reveals.js";
import "./clock.js";
import "./welcome-back.js";
import "./gate.js";
