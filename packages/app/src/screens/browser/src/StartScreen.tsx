import { useRef, useState } from "react";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { SettingsSectionTitle } from "@gleam/ui/src/primitives/setting-rows.tsx";
import { useT, type TFunction } from "../../../i18n";
import { BUILT_IN_SITES, knownSite, matchSites, pageTrail, parseAddress, siteHost, type KnownSite } from "./address";
import { BUILT_IN_ICONS, isMonoIcon } from "./built-in-icons";
import { originOf, trailText, type BrowserVisit } from "./history";
import { useVisitTime } from "./useVisitTime";

export interface StartScreenProps {
  /** What the user has typed in the address field. */
  query: string;
  saved: readonly string[];
  recent: readonly string[];
  /** Pages opened, newest first. */
  history: readonly BrowserVisit[];
  /** A saved site's stored icon, by origin. */
  icons: Readonly<Record<string, string>>;
  onOpen: (url: string) => void;
  onRemoveSaved: (origin: string) => void;
  /** Present only where the host can clear what sites stored. */
  onClearSiteData?: () => Promise<unknown>;
  /** Clears the recent sites and the page history. */
  onClearRecent?: () => Promise<unknown>;
  onOpenHistory: () => void;
}

function sitesOf(urls: readonly string[]): KnownSite[] {
  return urls.flatMap((url) => knownSite(url) ?? []);
}

/**
 * Where a page starts: saved sites, then the built-in dApps, then recent
 * ones. Typing narrows the same lists. An icon is bundled (built-ins) or
 * stored when the site was saved, and every other row carries a letter, so
 * showing this screen makes no network request.
 */
export function StartScreen({
  query,
  saved,
  recent,
  history,
  icons,
  onOpen,
  onRemoveSaved,
  onClearSiteData,
  onClearRecent,
  onOpenHistory,
}: StartScreenProps) {
  const t = useT();
  const visitTime = useVisitTime();
  /** Where the user last was on `origin` and when, from the newest visit there. */
  const lastVisit = (origin: string): string | undefined => {
    const visit = history.find((entry) => originOf(entry.url) === origin);
    return visit ? [trailText(visit.url), visitTime(visit.at)].filter(Boolean).join(" · ") : undefined;
  };
  const iconOf = (url: string): string | undefined => icons[url] ?? BUILT_IN_ICONS[url];
  const savedSites = sitesOf(saved);
  const builtIn = sitesOf(BUILT_IN_SITES);
  const shown = new Set([...savedSites, ...builtIn].map((site) => site.host));
  const recentSites = sitesOf(recent).filter((site) => !shown.has(site.host));

  if (query.trim() !== "") {
    const matches = matchSites(query, [...savedSites, ...builtIn, ...recentSites]);
    const address = parseAddress(query);
    const typed = address ? siteHost(address) : null;
    return (
      <div className="flex flex-col gap-1 px-5 pb-6">
        {matches.map((site) => (
          <SiteRow key={site.url} host={site.host} icon={iconOf(site.url)} onOpen={() => onOpen(site.url)} />
        ))}
        {address && typed ? (
          <SiteRow
            host={typed.host}
            insecure={typed.insecure}
            caption={pageTrail(address, { idEnds: true }).join(" › ") || t("browser.openAddress")}
            go
            onOpen={() => onOpen(address)}
          />
        ) : null}
        {!address && matches.length === 0 ? (
          <p className="px-0 py-4 text-label text-muted">{t("browser.noMatch")}</p>
        ) : null}
      </div>
    );
  }

  const hasHistory = recentSites.length > 0 || history.length > 0;

  return (
    <div className="flex flex-col gap-6 px-5 pb-6 pt-2">
      {savedSites.length > 0 ? (
        <Section title={t("browser.saved")} hint={t("browser.savedHint")}>
          {savedSites.map((site) => (
            <SiteRow
              key={site.url}
              host={site.host}
              icon={iconOf(site.url)}
              onOpen={() => onOpen(site.url)}
              onRemove={() => onRemoveSaved(site.url)}
            />
          ))}
        </Section>
      ) : null}
      <Section title={t("browser.dapps")}>
        {builtIn.map((site) => (
          <SiteRow key={site.url} host={site.host} icon={iconOf(site.url)} onOpen={() => onOpen(site.url)} />
        ))}
      </Section>
      {hasHistory ? (
        <Section
          title={t("browser.recent")}
          action={
            <button
              type="button"
              onClick={onOpenHistory}
              className="-mx-3 flex min-h-11 items-center gap-0.5 rounded-lg px-3 text-label font-semibold text-muted active:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
            >
              {t("browser.history")}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          }
        >
          {recentSites.map((site) => (
            <SiteRow key={site.url} host={site.host} caption={lastVisit(site.url)} onOpen={() => onOpen(site.url)} />
          ))}
        </Section>
      ) : null}
      {/* Housekeeping sits apart at the foot, so the site lists stay lists. */}
      {(onClearRecent && hasHistory) || onClearSiteData ? (
        <div className="flex flex-col items-start pt-4">
          {onClearRecent && hasHistory ? <ClearButton label={t("browser.clearHistory")} clear={onClearRecent} /> : null}
          {onClearSiteData ? <ClearSiteData clear={onClearSiteData} /> : null}
        </div>
      ) : null}
    </div>
  );
}

type ClearState = "idle" | "busy" | "done" | "failed";

function useClear(clear: () => Promise<unknown>) {
  const [state, setState] = useState<ClearState>("idle");
  const run = () => {
    setState("busy");
    clear().then(
      () => setState("done"),
      () => setState("failed"),
    );
  };
  return { state, run };
}

const clearLabel = (t: TFunction, state: ClearState, idle: string) =>
  state === "done" ? t("browser.cleared") : state === "failed" ? t("browser.clearFailed") : idle;

const CLEAR_BUTTON =
  "-mx-3 min-h-11 rounded-lg px-3 text-label font-semibold text-muted active:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-60";

/** Wipes something and says so; recents hold nothing worth a second tap. */
function ClearButton({ label, clear }: { label: string; clear: () => Promise<unknown> }) {
  const t = useT();
  const { state, run } = useClear(clear);
  return (
    <button
      type="button"
      disabled={state === "busy"}
      onClick={run}
      className={CLEAR_BUTTON}
    >
      {clearLabel(t, state, label)}
    </button>
  );
}

/**
 * Signs the user out of every site, so the tap asks first, in place, with
 * the same Cancel / confirm pair a held saved site uses before it is removed.
 */
function ClearSiteData({ clear }: { clear: () => Promise<unknown> }) {
  const t = useT();
  const { state, run } = useClear(clear);
  const [asking, setAsking] = useState(false);
  if (asking && state === "idle") {
    return (
      <div role="group" aria-label={t("browser.clearSiteData")} className="flex flex-col items-start gap-1">
        <p className="text-label text-foreground">{t("browser.clearSiteDataAsk")}</p>
        <div className="-mx-3 flex items-center">
          <button type="button" onClick={() => setAsking(false)} className="min-h-11 rounded-lg px-3 text-label font-semibold text-muted active:bg-hover">
            {t("browser.cancel")}
          </button>
          <button type="button" onClick={run} className="min-h-11 rounded-lg px-3 text-label font-semibold text-warning active:bg-hover">
            {t("browser.clear")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-0.5">
      <button type="button" disabled={state === "busy"} onClick={() => setAsking(true)} className={CLEAR_BUTTON}>
        {clearLabel(t, state, t("browser.clearSiteData"))}
      </button>
      <p className="text-caption text-faint">{t("browser.clearSiteDataHint")}</p>
    </div>
  );
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col">
      <div className="flex items-center justify-between">
        <SettingsSectionTitle as="h2">{title}</SettingsSectionTitle>
        {action}
      </div>
      <div className="flex flex-col">{children}</div>
      {hint ? <p className="pt-1 text-caption text-faint">{hint}</p> : null}
    </section>
  );
}

const HOLD_MS = 500;

interface SiteRowProps {
  host: string;
  /** A bundled or stored image URL, never one that asks the site. */
  icon?: string;
  insecure?: boolean;
  caption?: string;
  /** Ends the row with an arrow: it opens what was typed. */
  go?: boolean;
  onOpen: () => void;
  /** Present on a saved site: holding the row asks to remove it. */
  onRemove?: () => void;
}

function SiteRow({ host, icon, insecure = false, caption, go = false, onOpen, onRemove }: SiteRowProps) {
  const t = useT();
  const [removing, setRemoving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  const stopHold = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const startHold = () => {
    if (!onRemove) return;
    held.current = false;
    stopHold();
    timer.current = setTimeout(() => {
      held.current = true;
      setRemoving(true);
    }, HOLD_MS);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          // The release that ends a long press also clicks.
          if (held.current) {
            held.current = false;
            return;
          }
          onOpen();
        }}
        onPointerDown={startHold}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onContextMenu={(event) => {
          if (onRemove) event.preventDefault();
        }}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl py-2 text-left active:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
      >
        <SiteAvatar host={host} icon={icon} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-semibold text-foreground">{host}</span>
          {caption || insecure ? (
            <span className={cn("text-caption", insecure ? "text-warning" : "text-muted")}>
              {insecure ? t("browser.notSecureHttp") : caption}
            </span>
          ) : null}
        </span>
        {go ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mr-1 shrink-0 text-muted">
            <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>
      {removing ? (
        <>
          <button
            type="button"
            onClick={() => setRemoving(false)}
            className="min-h-11 rounded-lg px-3 text-label font-semibold text-muted"
          >
            {t("browser.cancel")}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="min-h-11 rounded-lg px-3 text-label font-semibold text-warning"
          >
            {t("browser.remove")}
          </button>
        </>
      ) : null}
    </div>
  );
}

/** The site's bundled or stored icon, or a letter when it has none or it fails to draw. */
export function SiteAvatar({ host, icon }: { host: string; icon?: string }) {
  const [failed, setFailed] = useState(false);
  const letter = host.replace(/^www\./, "").charAt(0).toUpperCase();
  if (icon && isMonoIcon(icon)) {
    const mask = `url("${icon}") center / contain no-repeat`;
    return (
      <span aria-hidden="true" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-mist">
        <span data-mono-icon="" className="h-6 w-6 bg-foreground" style={{ mask, WebkitMask: mask }} />
      </span>
    );
  }
  if (icon && !failed) {
    return (
      <span aria-hidden="true" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-mist">
        <img src={icon} alt="" className="h-6 w-6 object-contain dark:opacity-90" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-mist text-body font-bold text-muted"
    >
      {letter}
    </span>
  );
}
