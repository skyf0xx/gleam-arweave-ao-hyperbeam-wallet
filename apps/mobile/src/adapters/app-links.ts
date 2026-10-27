import { App } from "@capacitor/app";
import type { NoticePort } from "@gleam/app/src/app-platform/types.ts";
import { LINK_NOTICE } from "../worker/link-notice";
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

/**
 * The runtime worker's explanation for a link that did nothing, as the
 * app's notice. The worker only ever sends this one message besides
 * comlink's, and only a string is shown.
 */
export function createLinkNotices(worker: Pick<Worker, "addEventListener">): NoticePort {
  const listeners = new Set<(message: string) => void>();
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; message?: unknown } | null;
    if (data?.type !== LINK_NOTICE || typeof data.message !== "string") return;
    for (const listener of listeners) listener(data.message);
  });
  return {
    subscribe(onNotice) {
      listeners.add(onNotice);
      return () => listeners.delete(onNotice);
    },
  };
}
