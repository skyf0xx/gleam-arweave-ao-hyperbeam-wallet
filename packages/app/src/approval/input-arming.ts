import { useEffect, useState } from "react";

/**
 * How long a review screen must stay visible and focused before a click
 * on it counts. The approval window opens over whatever the user was
 * clicking, and a site chooses when it opens, so without this a click
 * aimed at the page can land on Approve.
 */
export const INPUT_ARM_DELAY_MS = 700;

/**
 * `true` once the window has been visible and focused for `delayMs`
 * since `screenKey` last changed. Losing focus or visibility disarms it
 * and restarts the wait, so a page that steals focus and hands it back
 * can't time a click either.
 */
export function useInputArmed(screenKey: string, delayMs: number = INPUT_ARM_DELAY_MS, win: Window = window): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const doc = win.document;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disarm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      setArmed(false);
    };
    const restart = () => {
      disarm();
      if (doc.visibilityState !== "visible" || !doc.hasFocus()) return;
      timer = setTimeout(() => setArmed(true), delayMs);
    };
    restart();
    win.addEventListener("focus", restart);
    win.addEventListener("blur", disarm);
    doc.addEventListener("visibilitychange", restart);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      win.removeEventListener("focus", restart);
      win.removeEventListener("blur", disarm);
      doc.removeEventListener("visibilitychange", restart);
    };
  }, [screenKey, delayMs, win]);
  // A delay of 0 turns the guard off, for tests that click straight away.
  return delayMs <= 0 || armed;
}
