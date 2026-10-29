import { useEffect, useState } from "react";

/** How long a cached refresh runs before the screen dims; faster ones never show. */
export const REFRESH_DIM_DELAY_MS = 600;

/**
 * `flag`, but only once it has stayed true for `delayMs`. Turns off at once.
 * A refresh that finishes quickly never shows its busy state.
 */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!flag) {
      setOn(false);
      return;
    }
    const timer = setTimeout(() => setOn(true), delayMs);
    return () => clearTimeout(timer);
  }, [flag, delayMs]);
  return flag && on;
}
