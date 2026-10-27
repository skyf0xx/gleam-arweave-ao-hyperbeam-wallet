import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Grant, RuntimePort, WalletState } from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { useBackHandler } from "@gleam/ui/src/primitives/back-stack.tsx";
import { usePlatform } from "../../../app-platform/context";
import type { DappBrowserFrame } from "../../../app-platform/types";
import { resolveInput, knownSite, BUILT_IN_SITES, siteHost } from "./address";
import { StartScreen } from "./StartScreen";
import { useBrowserSites } from "./useBrowserSites";

export interface BrowserViewProps {
  runtime: RuntimePort;
  /** Leaves the browser; the open page ends with it. */
  onBack: () => void;
  /** A page to open straight away, such as the one the user left for Connected apps. */
  initialUrl?: string;
  /** The connected-site chip: opens `origin`'s entry in Connected apps. `url` is the page to return to. */
  onOpenConnectedApp: (origin: string, url: string) => void;
  /** The wallet locked or was reset while the browser was open. */
  onLocked: () => void;
}

interface Navigation {
  url: string;
  canGoBack: boolean;
  loading: boolean;
}

const LOCK_POLL_MS = 10_000;

function frameOf(element: HTMLElement): DappBrowserFrame {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

function originOf(url: string): string | null {
  try {
    const { origin, protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * One page at a time, with the address bar and controls drawn here around
 * a placeholder. The host shows the page above the placeholder's rectangle,
 * so the rectangle is passed again whenever it moves. Anything this screen
 * draws over the page (the address suggestions, a load error) has to hide
 * the page first.
 */
export function BrowserView({ runtime, onBack, initialUrl, onOpenConnectedApp, onLocked }: BrowserViewProps) {
  const platform = usePlatform();
  const browser = platform.dappBrowser;
  const sites = useBrowserSites(runtime);
  const [page, setPage] = useState<{ url: string; id: number } | null>(initialUrl ? { url: initialUrl, id: 0 } : null);
  const [nav, setNav] = useState<Navigation | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [rejected, setRejected] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const placeholder = useRef<HTMLDivElement>(null);
  // Native calls run in order behind `open`, so a move or a hide never reaches a view that isn't there yet.
  const opening = useRef<Promise<unknown>>(Promise.resolve());
  const recorded = useRef<string | null>(null);
  const lockedRef = useRef(onLocked);
  useEffect(() => {
    lockedRef.current = onLocked;
  });

  const afterOpen = useCallback((run: () => Promise<void>) => {
    opening.current = opening.current.then(run).catch(() => undefined);
  }, []);

  const showingStart = page === null || editing;
  const currentUrl = nav?.url ?? page?.url ?? null;
  const origin = currentUrl ? originOf(currentUrl) : null;
  const host = currentUrl ? siteHost(currentUrl) : null;
  const saved = origin !== null && sites.saved.includes(origin);
  const grant = origin === null ? undefined : grants.find((candidate) => candidate.origin === origin);

  const open = (url: string) => {
    setEditing(false);
    setText("");
    setRejected(false);
    setFailedUrl(null);
    setNav(null);
    setPage((previous) => ({ url, id: (previous?.id ?? 0) + 1 }));
  };

  useLayoutEffect(() => {
    const element = placeholder.current;
    if (!page || !element) return;
    const frame = frameOf(element);
    opening.current = browser.open({ url: page.url, frame }).catch(() => {
      setFailedUrl(page.url);
    });
    // `page.url` is only read when a new page (`page.id`) is asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, browser]);

  // The page is the app's last layer, so it closes with the screen.
  useEffect(
    () => () => {
      browser.close().catch(() => undefined);
    },
    [browser],
  );

  useEffect(() => {
    const element = placeholder.current;
    if (!page || !element) return;
    const move = () => afterOpen(() => browser.setFrame(frameOf(element)));
    const observer = new ResizeObserver(move);
    observer.observe(element);
    window.addEventListener("resize", move);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", move);
    };
  }, [page, browser, afterOpen]);

  const covered = page !== null && (editing || failedUrl !== null);
  useEffect(() => {
    if (page) afterOpen(() => browser.setHidden(covered));
  }, [covered, page, browser, afterOpen]);

  useEffect(
    () =>
      browser.subscribe((event) => {
        if (event.kind === "loadError") {
          setFailedUrl(event.url);
          return;
        }
        setNav({ url: event.url, canGoBack: event.canGoBack, loading: event.loading });
        const next = originOf(event.url);
        if (next && next !== recorded.current) {
          recorded.current = next;
          runtime
            .send({ type: "recordRecentSite", payload: { url: event.url } })
            .then(() => sites.reload())
            .catch(() => undefined);
        }
      }),
    // `sites.reload` is stable per runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [browser, runtime],
  );

  const loadGrants = useCallback(() => {
    runtime
      .send<void, Grant[]>({ type: "getConnectedApps", payload: undefined })
      .then(setGrants)
      .catch(() => undefined);
  }, [runtime]);

  // A site may have been connected through an approval since the last look.
  useEffect(() => {
    loadGrants();
  }, [loadGrants, origin]);
  const subscribeSheet = platform.approvalSheet?.subscribe;
  useEffect(
    () =>
      subscribeSheet?.((requestId) => {
        if (requestId === null) loadGrants();
      }),
    [subscribeSheet, loadGrants],
  );

  // Auto-lock fires in the background with nothing telling the screen, and
  // the page sits above the lock screen, so the screen asks. Asking isn't
  // activity, or it would keep the wallet awake.
  useEffect(() => {
    const timer = setInterval(() => {
      runtime
        .send<{ recordActivity: boolean }, WalletState>({ type: "getState", payload: { recordActivity: false } })
        .then((state) => {
          if (state.session === null || state.session.unlockedWalletIds.length === 0) lockedRef.current();
        })
        .catch(() => undefined);
    }, LOCK_POLL_MS);
    return () => clearInterval(timer);
  }, [runtime]);

  const cancelEditing = () => {
    setEditing(false);
    setText("");
    setRejected(false);
  };

  const goBackInPage = () => {
    setFailedUrl(null);
    browser.goBack().catch(() => undefined);
  };

  useBackHandler(() => {
    if (page && editing) cancelEditing();
    else if (page && nav?.canGoBack) goBackInPage();
    else onBack();
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const known = [...sites.saved, ...BUILT_IN_SITES, ...sites.recent].flatMap((url) => knownSite(url) ?? []);
    const url = resolveInput(text, known);
    if (url) open(url);
    else setRejected(true);
  };

  const toggleSaved = () => {
    if (!currentUrl || !origin) return;
    runtime
      .send(saved ? { type: "removeBrowserSite", payload: { origin } } : { type: "saveBrowserSite", payload: { url: currentUrl } })
      .then(() => sites.reload())
      .catch(() => undefined);
  };

  const removeSaved = (site: string) => {
    runtime
      .send({ type: "removeBrowserSite", payload: { origin: site } })
      .then(() => sites.reload())
      .catch(() => undefined);
  };

  const retry = () => {
    setFailedUrl(null);
    browser.reload().catch(() => undefined);
  };

  return (
    <div className="flex h-[calc(100dvh-var(--safe-top)-var(--safe-bottom))] flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-2 pb-2 pt-1">
        {page === null ? <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton> : null}
        {showingStart ? (
          <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1">
            <input
              type="text"
              inputMode="url"
              enterKeyHint="go"
              aria-label="Address"
              placeholder="Search saved sites or enter an address"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus={editing}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setRejected(false);
              }}
              className="min-w-0 flex-1 rounded-xl bg-mist px-3.5 py-2.5 text-body text-foreground placeholder:text-faint focus:outline focus:outline-2 focus:outline-foreground"
            />
            {page ? (
              <button type="button" onClick={cancelEditing} className="min-h-11 rounded-lg px-3 text-label font-semibold text-muted">
                Cancel
              </button>
            ) : null}
          </form>
        ) : (
          <button
            type="button"
            aria-label={`Address, ${host?.host ?? ""}. Edit`}
            onClick={() => setEditing(true)}
            className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-mist px-3.5 text-body text-foreground"
          >
            {host?.insecure ? (
              <span className="flex flex-shrink-0 items-center gap-1 text-label font-semibold text-warning">
                <WarningIcon />
                Not secure
              </span>
            ) : null}
            <span className="truncate">{host?.host ?? ""}</span>
          </button>
        )}
      </div>
      {rejected ? (
        <p role="alert" className="px-5 pb-2 text-caption text-warning">
          Enter a web address like example.com.
        </p>
      ) : null}
      {page && nav?.loading && !showingStart ? <Beam /> : <div className="h-[3px]" />}

      <div className="relative min-h-0 flex-1">
        {page ? <div ref={placeholder} data-testid="page-placeholder" className="absolute inset-0 bg-mist" /> : null}
        {showingStart ? (
          <div className="absolute inset-0 overflow-y-auto bg-background">
            <StartScreen query={text} saved={sites.saved} recent={sites.recent} onOpen={open} onRemoveSaved={removeSaved} />
          </div>
        ) : null}
        {failedUrl !== null && !showingStart ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background px-8 text-center">
            <p className="text-body text-foreground">
              Couldn&apos;t load {siteHost(failedUrl)?.host ?? "this page"}.
            </p>
            <button
              type="button"
              onClick={retry}
              className="min-h-11 rounded-lg bg-foreground px-5 text-label font-semibold text-background"
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>

      {page && !editing ? (
        <div className="flex items-center gap-1 px-2 pt-1">
          <IconButton label="Back in page" onClick={goBackInPage} disabled={!nav?.canGoBack}><BackIcon /></IconButton>
          <IconButton label="Reload" onClick={retry}><ReloadIcon /></IconButton>
          <IconButton
            label={saved ? "Remove from saved sites" : "Save site"}
            pressed={saved}
            onClick={toggleSaved}
            disabled={origin === null}
          >
            <StarIcon filled={saved} />
          </IconButton>
          {grant && origin ? (
            <button
              type="button"
              onClick={() => onOpenConnectedApp(origin, currentUrl ?? origin)}
              className="ml-1 flex min-h-11 min-w-0 items-center gap-1.5 rounded-full bg-mist px-3.5 text-label font-semibold text-foreground"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-positive" />
              <span className="truncate">Connected</span>
            </button>
          ) : null}
          <div className="flex-1" />
          <IconButton label="Close browser" onClick={onBack}><CloseIcon /></IconButton>
        </div>
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-muted active:bg-mist disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
    >
      {children}
    </button>
  );
}

const stroke = { stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m15 18-6-6 6-6" {...stroke} />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" {...stroke} />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z" {...stroke} />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" {...stroke} />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 2 20h20L12 3ZM12 10v4M12 17h.01" {...stroke} />
    </svg>
  );
}
