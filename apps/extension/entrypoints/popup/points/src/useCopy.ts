import { useEffect, useRef, useState } from "react";

const COPIED_MS = 1500;

/** Copies text to the clipboard and reports `copied` briefly afterwards. */
export function useCopy(text: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    copied,
    copy: () => {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      });
    },
  };
}
