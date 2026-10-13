import { useState } from "react";
import type { PermissionType, RuntimePort } from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { hostnameOf, siteCardFor } from "./site-card";
import { useActiveSite, useDismissSiteSuggestion, useStopGleamOnSite } from "./useActiveSite";

export interface SiteWalletCardProps {
  runtime: RuntimePort;
  onUseGleam: (site: { origin: string; favIconUrl: string | null; requestedPermissions: PermissionType[] }) => void;
}

/**
 * The main screen's line about the site in the active tab, shown only when
 * another wallet extension is on the page. It sits below the account
 * header in weight: one row, the site and a single action. The beam edge
 * marks the offer to bring Gleam in. A connected site is just a green dot
 * and its name.
 */
export function SiteWalletCard({ runtime, onUseGleam }: SiteWalletCardProps) {
  const site = useActiveSite(runtime);
  const dismiss = useDismissSiteSuggestion(runtime);
  const stop = useStopGleamOnSite(runtime);
  const card = siteCardFor(site.data);
  if (card === null) return null;

  const host = hostnameOf(card.origin);

  if (card.kind === "active") {
    return (
      <section aria-label="This site" className="mx-5 mb-1 flex items-center gap-2 pl-0.5">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-positive" />
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted">
          <span className="sr-only">Connected to </span>
          {host}
        </span>
        <button
          type="button"
          disabled={stop.isPending}
          onClick={() => stop.mutate(card.origin)}
          className="flex-shrink-0 rounded-md px-2 py-1 text-caption font-semibold text-muted hover:bg-mist hover:text-foreground disabled:opacity-50"
        >
          {stop.isPending ? "Disconnecting…" : "Disconnect"}
        </button>
      </section>
    );
  }

  return (
    <section aria-label="This site" className="mx-5 mb-2 overflow-hidden rounded-lg border-[0.5px] border-line bg-background">
      <Beam className="h-0.5 rounded-none" />
      <div className="flex items-center gap-2.5 py-1.5 pl-2.5">
        <SiteIcon origin={card.origin} favIconUrl={card.favIconUrl} />
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted">{host}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="border-[0.5px]"
          onClick={() =>
            onUseGleam({ origin: card.origin, favIconUrl: card.favIconUrl, requestedPermissions: card.requestedPermissions })
          }
        >
          Use Gleam here
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismiss.mutate(card.origin)}
          className="flex h-8 w-7 flex-shrink-0 items-center justify-center text-body text-faint hover:text-foreground"
        >
          ×
        </button>
      </div>
    </section>
  );
}

/** The site's favicon, or the first letter of its hostname when it has none or it fails to load. */
export function SiteIcon({
  origin,
  favIconUrl,
  size = "sm",
}: {
  origin: string;
  favIconUrl: string | null;
  size?: "sm" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const box =
    size === "lg"
      ? "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-mist"
      : "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-line bg-mist";

  if (favIconUrl && !failed) {
    return (
      <div aria-hidden="true" className={box}>
        <img
          src={favIconUrl}
          alt=""
          referrerPolicy="no-referrer"
          className={size === "lg" ? "h-7 w-7" : "h-4 w-4"}
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={cn(box, "font-bold text-muted", size === "lg" ? "text-lg" : "text-caption")}>
      {hostnameOf(origin).charAt(0).toUpperCase()}
    </div>
  );
}
