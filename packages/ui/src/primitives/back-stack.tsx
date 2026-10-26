import { createContext, useContext, useEffect, useRef } from "react";

/**
 * What a hardware or system back press should undo, newest first. Each
 * `ScreenHeader` with a back arrow registers its `onBack`, and anything
 * that opens over a screen (a confirmation, a form) registers how to close
 * itself, so the press undoes whatever the user would have tapped Back on.
 * Where nothing is registered the shell decides (Android minimises).
 */
export interface BackStack {
  /** `read` returns what to run, or `null` while this entry has nothing to undo. */
  register(read: () => (() => void) | null): () => void;
  /** Runs the newest entry that has something to undo. False when none did. */
  handle(): boolean;
}

export function createBackStack(): BackStack {
  const entries: Array<() => (() => void) | null> = [];
  return {
    register(read) {
      entries.push(read);
      return () => {
        const index = entries.lastIndexOf(read);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    handle() {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const run = entries[index]?.();
        if (run) {
          run();
          return true;
        }
      }
      return false;
    },
  };
}

/** Absent in the popup, side panel and approval window, which have no system back press. */
export const BackStackContext = createContext<BackStack | null>(null);

/**
 * Registers `handler` for the system back press while the caller is mounted.
 * A `null` handler leaves the press to whatever sits below. Entries rank by
 * mount order, so a later-mounted overlay is asked before its screen.
 */
export function useBackHandler(handler: (() => void) | null | undefined): void {
  const stack = useContext(BackStackContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => stack?.register(() => latest.current ?? null), [stack]);
}
