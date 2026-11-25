import { S } from "./state.js";

export var soundButton = document.querySelector(".v-sound");
var soundLabel = soundButton && soundButton.querySelector("[data-sound-label]");

export function showSound() {
  soundButton.setAttribute("aria-pressed", String(S.soundOn));
  soundLabel.textContent = S.soundOn ? "Sound on" : "Sound off";
}

// A ping just played silently: the button glows in time with it, so the
// visitor sees there's something to hear
export function hintSound() {
  if (!soundButton || soundButton.classList.contains("hint")) return;
  soundButton.classList.add("hint");
}
