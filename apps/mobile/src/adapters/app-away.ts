import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/**
 * Calls `listener` each time the user leaves the app. On Android that is
 * the activity stopping, not pausing: a runtime permission dialog, such as
 * the camera prompt the Keystone scanner raises inside the approval sheet,
 * pauses the activity while the user stays in the app. On iOS `pause` is
 * the app entering the background, which a permission alert doesn't do.
 */
export function onAppAway(listener: () => void): void {
  if (Capacitor.getPlatform() === "android") {
    void App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) listener();
    });
  } else {
    void App.addListener("pause", listener);
  }
}
