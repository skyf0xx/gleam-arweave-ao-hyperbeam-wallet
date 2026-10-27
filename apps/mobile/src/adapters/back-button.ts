import { App } from "@capacitor/app";
import type { BackButtonPort } from "@gleam/app/src/app-platform/types.ts";

/**
 * Android's back button and gesture. Once a listener is registered the OS
 * default (leave the WebView's history, then close the app) is off, so a
 * press the app didn't use has to minimise it here: closing the activity
 * would drop the unlocked session's in-memory state. iOS never fires it.
 */
export function createBackButton(): BackButtonPort {
  return {
    subscribe(handler) {
      const listener = App.addListener("backButton", () => {
        if (!handler()) void App.minimizeApp();
      });
      return () => {
        void listener.then((handle) => handle.remove());
      };
    },
  };
}
