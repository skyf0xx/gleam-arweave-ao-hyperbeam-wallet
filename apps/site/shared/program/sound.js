import { S } from "./state.js";
import { armAudio } from "./engine.js";
import { ping } from "./notes.js";
import { updatePad } from "./pad.js";
import { soundButton, showSound } from "./button.js";

["pointerdown", "keydown", "touchend"].forEach(function (type) {
  window.addEventListener(type, armAudio, { capture: true, passive: true });
});

if (soundButton) {
  soundButton.hidden = false;
  showSound();
  soundButton.addEventListener("animationend", function () {
    soundButton.classList.remove("hint");
  });
  soundButton.addEventListener("click", function () {
    S.soundOn = !S.soundOn;
    showSound();
    soundButton.classList.remove("hint");
    // armAudio already ran on pointerdown/keydown; this confirms it works
    if (S.soundOn && S.audio) {
      S.audio.ctx.resume().then(function () {
        ping(2);
        ping(4, 0.09);
        updatePad(1.2);
      });
    } else {
      updatePad(0.3);
    }
  });
}

// Sound on from a click the page itself asked for (the Vision page's gate).
// then runs once audio is actually playing, or straight away without Web
// Audio.
export function enableSound(then) {
  S.soundOn = true;
  if (soundButton) showSound();
  armAudio();
  if (!S.audio) {
    if (then) then();
    return;
  }
  S.audio.ctx.resume().then(function () {
    updatePad(1.2);
    if (then) then();
  });
}
