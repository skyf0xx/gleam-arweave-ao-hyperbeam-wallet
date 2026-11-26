import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/** The app module's own `OverlayGuardPlugin.java`, Android only. */
export interface OverlayGuardPlugin {
  setGuarded(options: { guarded: boolean }): Promise<void>;
  addListener(event: "touchBlocked", listener: () => void): Promise<PluginListenerHandle>;
}

export interface OverlayGuard {
  /** Whether taps that pass through another app's window are dropped. */
  setGuarded(guarded: boolean): void;
  /** Calls `listener` each time a tap was dropped. Returns the unsubscribe function. */
  onTouchBlocked(listener: () => void): () => void;
}

/**
 * Turns overlay protection on and off. Each change is sent only when it
 * differs from the last, since the sheet reports every request it shows.
 */
export function createOverlayGuard(plugin = registerPlugin<OverlayGuardPlugin>("OverlayGuard")): OverlayGuard {
  let current = false;
  return {
    setGuarded(guarded) {
      if (guarded === current) return;
      current = guarded;
      plugin.setGuarded({ guarded }).catch((error: unknown) => console.error("Couldn't change the overlay guard.", error));
    },
    onTouchBlocked(listener) {
      const handle = plugin.addListener("touchBlocked", listener);
      return () => {
        void handle.then((h) => h.remove()).catch(() => undefined);
      };
    },
  };
}
