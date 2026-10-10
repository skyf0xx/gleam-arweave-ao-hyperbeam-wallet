import { browser } from "wxt/browser";
import { sitePageUrl } from "@/src/site-pages";

/** points.html, which drops its install CTAs for a visitor the extension sent (?v=). */
export function howItWorksUrl(): string {
  return sitePageUrl("points", browser.runtime.getManifest().version);
}

/** gleam.html, what points convert to; it too drops its install CTAs for ?v= visitors. */
export function gleamUrl(): string {
  return sitePageUrl("gleam", browser.runtime.getManifest().version);
}

/** The disclosure shown wherever joining Gleam Points is offered. */
export function JoinNote() {
  return (
    <p className="text-center text-caption text-faint">
      Joining links this wallet's address to this browser on the Gleam Points server.{" "}
      <a href={howItWorksUrl()} target="_blank" rel="noreferrer" className="underline hover:text-muted">
        How points work
      </a>
    </p>
  );
}
