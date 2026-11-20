import { useState } from "react";
import type { PermissionType, RuntimePort } from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { useT } from "../../../i18n";
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
  const t = useT();
  const site = useActiveSite(runtime);
  const dismiss = useDismissSiteSuggestion(runtime);
  const stop = useStopGleamOnSite(runtime);
  const card = siteCardFor(site.data);
  if (card === null) return null;

  const host = hostnameOf(card.origin);

  if (card.kind === "active") {
    return (
      <section aria-label={t("siteWallet.thisSite")} className="mx-5 mb-1 flex items-center gap-2 pl-0.5">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-positive" />
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted">
          <span className="sr-only">{t("siteWallet.connectedTo")} </span>
          {host}
        </span>
        <button
          type="button"
          disabled={stop.isPending}
          onClick={() => stop.mutate(card.origin)}
          className="flex-shrink-0 rounded-md px-2 py-1 text-caption font-semibold text-muted hover:bg-hover hover:text-foreground disabled:opacity-50"
        >
          {stop.isPending ? t("siteWallet.disconnecting") : t("siteWallet.disconnect")}
        </button>
      </section>
    );
  }

  return (
    <section aria-label={t("siteWallet.thisSite")} className="mx-5 mb-2 overflow-hidden rounded-lg border-[0.5px] border-line bg-background">
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
          {t("siteWallet.useGleamHere")}
        </Button>
        <button
          type="button"
          aria-label={t("siteWallet.dismiss")}
          onClick={() => dismiss.mutate(card.origin)}
          className="flex h-8 w-7 flex-shrink-0 items-center justify-center text-body text-faint hover:text-foreground"
        >
          ×
        </button>
      </div>
    </section>
  );
}

const SITE_ICON_SIZES = {
  sm: { box: "h-6 w-6 rounded-md border border-line", image: "h-4 w-4", letter: "text-caption" },
  md: { box: "h-9 w-9 rounded-xl", image: "h-5 w-5", letter: "text-label" },
  lg: { box: "h-12 w-12 rounded-lg border border-line", image: "h-7 w-7", letter: "text-lg" },
} as const;

/** The site's favicon, or the first letter of its hostname when it has none or it fails to load. */
export function SiteIcon({
  origin,
  favIconUrl,
  size = "sm",
  className,
}: {
  origin: string;
  favIconUrl: string | null;
  size?: keyof typeof SITE_ICON_SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const sizes = SITE_ICON_SIZES[size];
  const box = cn("flex flex-shrink-0 items-center justify-center bg-mist", sizes.box, className);

  if (favIconUrl && !failed) {
    return (
      <div aria-hidden="true" className={box}>
        <img
          src={favIconUrl}
          alt=""
          referrerPolicy="no-referrer"
          className={sizes.image}
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={cn(box, "font-bold text-muted", sizes.letter)}>
      {hostnameOf(origin).charAt(0).toUpperCase()}
    </div>
  );
}
