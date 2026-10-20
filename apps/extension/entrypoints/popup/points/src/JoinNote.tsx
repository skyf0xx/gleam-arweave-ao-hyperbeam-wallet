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

/** scan.html, where a member hands their AI agent the steps to audit Gleam for points. */
export function scanUrl(): string {
  return sitePageUrl("scan", browser.runtime.getManifest().version);
}

/**
 * The disclosure shown wherever joining Gleam Points is offered. The
 * Points screen drops the link because its About section carries it.
 */
export function JoinNote({ withLink = true }: { withLink?: boolean }) {
  return (
    <p className="text-center text-caption text-faint">
      Joining links this wallet's address to this browser on the Gleam Points server.
      {withLink ? (
        <>
          {" "}
          <a href={howItWorksUrl()} target="_blank" rel="noreferrer" className="underline hover:text-muted">
            How to earn points
          </a>
        </>
      ) : null}
    </p>
  );
}
