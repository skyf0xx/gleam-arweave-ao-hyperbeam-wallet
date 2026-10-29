import { useRef, useState } from "react";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { BUILT_IN_SITES, knownSite, matchSites, parseAddress, siteHost, type KnownSite } from "./address";

export interface StartScreenProps {
  /** What the user has typed in the address field. */
  query: string;
  saved: readonly string[];
  recent: readonly string[];
  onOpen: (url: string) => void;
  onRemoveSaved: (origin: string) => void;
  /** Present only where the host can clear what sites stored. */
  onClearSiteData?: () => Promise<unknown>;
  onClearRecent?: () => Promise<unknown>;
}

function sitesOf(urls: readonly string[]): KnownSite[] {
  return urls.flatMap((url) => knownSite(url) ?? []);
}

/**
 * Where a page starts: saved sites, then the built-in dApps, then recent
 * ones. Typing narrows the same lists. Rows carry a letter, never a
 * fetched icon, so showing this screen makes no network request.
 */
export function StartScreen({ query, saved, recent, onOpen, onRemoveSaved, onClearSiteData, onClearRecent }: StartScreenProps) {
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
          <SiteRow key={site.url} host={site.host} onOpen={() => onOpen(site.url)} />
        ))}
        {address && typed ? (
          <SiteRow host={typed.host} insecure={typed.insecure} caption="Open this address" onOpen={() => onOpen(address)} />
        ) : null}
        {!address && matches.length === 0 ? (
          <p className="px-0 py-4 text-label text-muted">No saved site matches. Enter an address like example.com.</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-5 pb-6 pt-2">
      {savedSites.length > 0 ? (
        <Section title="Saved" hint="Press and hold a site to remove it.">
          {savedSites.map((site) => (
            <SiteRow
              key={site.url}
              host={site.host}
              onOpen={() => onOpen(site.url)}
              onRemove={() => onRemoveSaved(site.url)}
            />
          ))}
        </Section>
      ) : null}
      <Section title="dApps">
        {builtIn.map((site) => (
          <SiteRow key={site.url} host={site.host} onOpen={() => onOpen(site.url)} />
        ))}
      </Section>
      {recentSites.length > 0 ? (
        <Section
          title="Recent"
          action={onClearRecent ? <ClearButton label="Clear" ariaLabel="Clear recent sites" clear={onClearRecent} /> : undefined}
        >
          {recentSites.map((site) => (
            <SiteRow key={site.url} host={site.host} onOpen={() => onOpen(site.url)} />
          ))}
        </Section>
      ) : null}
      {onClearSiteData ? (
        <ClearSiteData clear={onClearSiteData} />
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

const clearLabel = (state: ClearState, idle: string) =>
  state === "done" ? "Cleared" : state === "failed" ? "Couldn't clear" : idle;

const CLEAR_BUTTON =
  "-mx-3 min-h-11 rounded-lg px-3 text-label font-semibold text-muted active:bg-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-60";

/** Wipes something and says so; recents hold nothing worth a second tap. */
function ClearButton({ label, ariaLabel, clear }: { label: string; ariaLabel?: string; clear: () => Promise<unknown> }) {
  const { state, run } = useClear(clear);
  return (
    <button
      type="button"
      aria-label={state === "idle" ? ariaLabel : undefined}
      disabled={state === "busy"}
      onClick={run}
      className={CLEAR_BUTTON}
    >
      {clearLabel(state, label)}
    </button>
  );
}

/**
 * Signs the user out of every site, so the tap asks first, in place, with
 * the same Cancel / confirm pair a held saved site uses before it is removed.
 */
function ClearSiteData({ clear }: { clear: () => Promise<unknown> }) {
  const { state, run } = useClear(clear);
  const [asking, setAsking] = useState(false);
  if (asking && state === "idle") {
    return (
      <div role="group" aria-label="Clear site data" className="flex flex-col items-start gap-1">
        <p className="text-label text-foreground">Sign out of all sites and delete what they stored?</p>
        <div className="-mx-3 flex items-center">
          <button type="button" onClick={() => setAsking(false)} className="min-h-11 rounded-lg px-3 text-label font-semibold text-muted active:bg-mist">
            Cancel
          </button>
          <button type="button" onClick={run} className="min-h-11 rounded-lg px-3 text-label font-semibold text-warning active:bg-mist">
            Clear
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-0.5">
      <button type="button" disabled={state === "busy"} onClick={() => setAsking(true)} className={CLEAR_BUTTON}>
        {clearLabel(state, "Clear site data")}
      </button>
      <p className="text-caption text-faint">Signs you out of sites and deletes what they stored.</p>
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
        <h2 className="pb-1 text-label font-semibold uppercase tracking-[0.04em] text-muted">{title}</h2>
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
  insecure?: boolean;
  caption?: string;
  onOpen: () => void;
  /** Present on a saved site: holding the row asks to remove it. */
  onRemove?: () => void;
}

function SiteRow({ host, insecure = false, caption, onOpen, onRemove }: SiteRowProps) {
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
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl py-2 text-left active:bg-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
      >
        <SiteAvatar host={host} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-semibold text-foreground">{host}</span>
          {caption || insecure ? (
            <span className={cn("text-caption", insecure ? "text-warning" : "text-muted")}>
              {insecure ? "Not secure (http)" : caption}
            </span>
          ) : null}
        </span>
      </button>
      {removing ? (
        <>
          <button
            type="button"
            onClick={() => setRemoving(false)}
            className="min-h-11 rounded-lg px-3 text-label font-semibold text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="min-h-11 rounded-lg px-3 text-label font-semibold text-warning"
          >
            Remove
          </button>
        </>
      ) : null}
    </div>
  );
}

/** A letter on a quiet square, so the start screen never asks a site for its icon. */
export function SiteAvatar({ host }: { host: string }) {
  const letter = host.replace(/^www\./, "").charAt(0).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-mist text-body font-bold text-muted"
    >
      {letter}
    </span>
  );
}
