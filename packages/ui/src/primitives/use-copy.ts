import { useCallback, useEffect, useRef, useState } from "react";

/** Writes to the clipboard; a denied write is soft, the value is still on screen. */
export async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard access can be denied by the browser.
  }
}

/** A `copied` flag that turns on at `flash()` and off again after `durationMs`. */
export function useCopiedFlag(durationMs: number): { copied: boolean; flash: () => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = useCallback(() => {
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), durationMs);
  }, [durationMs]);

  return { copied, flash };
}

/** Copies text to the clipboard and reports `copied` briefly afterwards. */
export function useCopy(text: string, durationMs = 1500): { copied: boolean; copy: () => void } {
  const { copied, flash } = useCopiedFlag(durationMs);
  return {
    copied,
    copy: () => {
      void navigator.clipboard?.writeText(text).then(flash);
    },
  };
}
