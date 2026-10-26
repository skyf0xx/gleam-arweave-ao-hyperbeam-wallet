import { App } from "@capacitor/app";
import type { PointsLinkOutcome } from "../worker/points-link";

/**
 * Hands every link the OS opens the app with to the runtime worker as the
 * raw string, which decides what it is (`createPointsLinks`). A cold start
 * needs no `getLaunchUrl`: both platforms deliver the launch link as an
 * `appUrlOpen` that waits for this listener, so reading it too would run
 * it twice. `onGate` runs when an invite gave the Founding gate a new
 * verdict to show.
 */
export function listenForAppLinks(openLink: (url: string) => Promise<PointsLinkOutcome>, onGate: () => void): void {
  void App.addListener("appUrlOpen", ({ url }) => {
    openLink(url)
      .then((outcome) => {
        if (outcome === "gate") onGate();
      })
      .catch((error: unknown) => console.error("Couldn't open the link.", error));
  });
}
