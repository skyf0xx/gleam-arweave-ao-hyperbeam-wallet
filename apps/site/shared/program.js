// Shared by the Gleam Points program pages: gleam.html, points.html and
// invite.html. Exposes window.GleamProgram: the beam colours, the odometer, the
// ping and its toggle, and one-shot reveals. Each page's own script drives them.
// Pieces are in program/; the pages' classic scripts read the window global.
import { S } from "./program/state.js";
import { COLORS, colorFor, motion, restart } from "./program/core.js";
import { odometer } from "./program/odometer.js";
import { reveal } from "./program/reveal.js";
import { presence } from "./program/engine.js";
import { ping, soft, loud, thump, boom } from "./program/notes.js";
import { VOICES, SCALES, play, whoosh, sweep, tick } from "./program/voices.js";
import { setPadChord, updatePad } from "./program/pad.js";
import { enableSound } from "./program/sound.js";

window.GleamProgram = {
  COLORS: COLORS,
  colorFor: colorFor,
  motion: motion,
  restart: restart,
  odometer: odometer,
  ping: ping,
  enableSound: enableSound,
  soft: soft,
  tick: tick,
  loud: loud,
  thump: thump,
  boom: boom,
  sweep: sweep,
  play: play,
  whoosh: whoosh,
  VOICES: Object.keys(VOICES),
  SCALES: Object.keys(SCALES),
  pad: function () {
    S.padWanted = true;
    updatePad(1.2);
  },
  padChord: setPadChord,
  presence: presence,
  reveal: reveal,
};
