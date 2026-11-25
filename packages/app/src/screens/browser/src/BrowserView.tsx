import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { RuntimePort, WalletState } from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { useBackHandler } from "@gleam/ui/src/primitives/back-stack.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { usePlatform } from "../../../app-platform/context";
import type { DappBrowserFrame } from "../../../app-platform/types";
import { resolveInput, knownSite, BUILT_IN_SITES, pageTrail, siteHost } from "./address";
import { useT } from "../../../i18n";
import { useConnectedApps } from "../../connected-apps/src/useConnectedApps";
import { StartScreen } from "./StartScreen";
import { HistoryScreen } from "./HistoryScreen";
import { useBrowserSites } from "./useBrowserSites";

export interface BrowserViewProps {
  runtime: RuntimePort;
  /** Leaves the browser from its start screen; an open page ends with it. */
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
// A shortener (t.co, bit.ly) finishes loading and then redirects by meta
// refresh or script, so an origin counts as visited only once its page has
// loaded and stayed this long.
const RECENT_SETTLE_MS = 1_500;

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
  const t = useT();
  const platform = usePlatform();
  const browser = platform.dappBrowser;
  const sites = useBrowserSites(runtime);
  const [page, setPage] = useState<{ url: string; id: number } | null>(initialUrl ? { url: initialUrl, id: 0 } : null);
  const [nav, setNav] = useState<Navigation | null>(null);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [text, setText] = useState("");
  const [rejected, setRejected] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { data: grants = [], refetch: loadGrants } = useConnectedApps(runtime);
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

  const showingStart = (page === null || editing) && !historyOpen;
  const currentUrl = nav?.url ?? page?.url ?? null;
  const origin = currentUrl ? originOf(currentUrl) : null;
  const host = currentUrl ? siteHost(currentUrl) : null;
  const trail = currentUrl ? pageTrail(currentUrl) : [];
  const saved = origin !== null && sites.saved.includes(origin);
  // Bumped by a tap that saves, so the star pops then and not when a saved page opens.
  const [starPop, setStarPop] = useState(0);
  const grant = origin === null ? undefined : grants.find((candidate) => candidate.origin === origin);

  const open = (url: string) => {
    setEditing(false);
    setHistoryOpen(false);
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

  const covered = page !== null && (editing || historyOpen || failedUrl !== null);
  useEffect(() => {
    if (page) afterOpen(() => browser.setHidden(covered));
  }, [covered, page, browser, afterOpen]);

  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = browser.subscribe((event) => {
      if (event.kind === "loadError") {
        setFailedUrl(event.url);
        return;
      }
      setNav({ url: event.url, canGoBack: event.canGoBack, loading: event.loading });
      clearTimeout(settle);
      const title = event.title ?? "";
      // A title that arrives after the page settled records the page again, which updates its visit.
      const key = `${event.url}\n${title}`;
      if (event.loading || !originOf(event.url) || key === recorded.current) return;
      settle = setTimeout(() => {
        recorded.current = key;
        runtime
          .send({ type: "recordRecentSite", payload: title ? { url: event.url, title } : { url: event.url } })
          .then(() => sites.reload())
          .catch(() => undefined);
      }, RECENT_SETTLE_MS);
    });
    return () => {
      clearTimeout(settle);
      unsubscribe();
    };
  },
    // `sites.reload` is stable per runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [browser, runtime],
  );

  // A site may have been connected through an approval since the last look.
  useEffect(() => {
    void loadGrants();
  }, [loadGrants, origin]);
  const subscribeSheet = platform.approvalSheet?.subscribe;
  useEffect(
    () =>
      subscribeSheet?.((requestId) => {
        if (requestId === null) void loadGrants();
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

  // Leaving a page lands on the start screen (saved and recent sites), not the main screen.
  const closePage = () => {
    cancelEditing();
    setFailedUrl(null);
    setNav(null);
    setPage(null);
    recorded.current = null;
    afterOpen(() => browser.close());
  };

  useBackHandler(() => {
    if (historyOpen) setHistoryOpen(false);
    else if (page && editing) cancelEditing();
    else if (page && nav?.canGoBack) goBackInPage();
    else if (page) closePage();
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
    const url = currentUrl;
    const site = origin;
    if (saved) {
      sites.setSaved(site, false, () => runtime.send({ type: "removeBrowserSite", payload: { origin: site } }));
      return;
    }
    setStarPop((count) => count + 1);
    sites.setSaved(site, true, () =>
      savedIcon(site).then((icon) => runtime.send({ type: "saveBrowserSite", payload: icon ? { url, icon } : { url } })),
    );
  };

  /** The page's icon, if it is still on `site`; saving never waits on or fails for it. */
  const savedIcon = (site: string) =>
    browser.pageIcon().then(
      (icon) => (icon && icon.origin === site ? icon.dataUrl : undefined),
      () => undefined,
    );

  const removeSaved = (site: string) => {
    sites.setSaved(site, false, () => runtime.send({ type: "removeBrowserSite", payload: { origin: site } }));
  };

  const clearRecent = () =>
    runtime.send({ type: "clearRecentSites", payload: undefined }).then(() => sites.reload());

  const retry = () => {
    setFailedUrl(null);
    browser.reload().catch(() => undefined);
  };

  return (
    <div className="flex h-[calc(100dvh-var(--safe-top)-var(--safe-bottom))] flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-2 pb-2 pt-1">
        {historyOpen ? (
          <>
            <IconButton label={t("browser.back")} onClick={() => setHistoryOpen(false)}><BackIcon /></IconButton>
            <h1 className="min-w-0 flex-1 truncate text-center text-body font-semibold text-foreground">{t("browser.history")}</h1>
            <div aria-hidden="true" className="w-11 flex-shrink-0" />
          </>
        ) : page === null ? (
          <IconButton label={t("browser.back")} onClick={onBack}><BackIcon /></IconButton>
        ) : null}
        {historyOpen ? null : showingStart ? (
          <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1">
            <input
              type="text"
              inputMode="url"
              enterKeyHint="go"
              aria-label={t("browser.address")}
              placeholder={t("browser.addressPlaceholder")}
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
                {t("browser.cancel")}
              </button>
            ) : null}
          </form>
        ) : (
          <button
            type="button"
            aria-label={t("browser.addressEdit", { host: host?.host ?? "" })}
            onClick={() => setEditing(true)}
            className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-mist px-3.5 text-body text-foreground"
          >
            {host?.insecure ? (
              <span className="flex flex-shrink-0 items-center gap-1 text-label font-semibold text-warning">
                <WarningIcon />
                {t("browser.notSecure")}
              </span>
            ) : null}
            {/* The host is what to trust, so the path gives way first. */}
            <span className="max-w-full flex-shrink-0 truncate">{host?.host ?? ""}</span>
            {trail.length > 0 ? (
              <span aria-hidden="true" className="min-w-0 truncate text-label text-muted">
                {trail.map((segment) => `› ${segment}`).join(" ")}
              </span>
            ) : null}
          </button>
        )}
      </div>
      {rejected ? (
        <InlineError className="px-5 pb-2">
          {t("browser.enterAddress")}
        </InlineError>
      ) : null}
      {page && nav?.loading && !showingStart && !historyOpen ? <Beam /> : <div className="h-[3px]" />}

      <div className="relative min-h-0 flex-1">
        {page ? <div ref={placeholder} data-testid="page-placeholder" className="absolute inset-0 bg-mist" /> : null}
        {showingStart ? (
          <div className="absolute inset-0 overflow-y-auto bg-background">
            <StartScreen
              query={text}
              saved={sites.saved}
              recent={sites.recent}
              history={sites.history}
              icons={sites.icons}
              onOpen={open}
              onRemoveSaved={removeSaved}
              onClearSiteData={platform.capabilities.dappBrowser ? () => browser.clearSiteData() : undefined}
              onClearRecent={platform.capabilities.dappBrowser ? clearRecent : undefined}
              onOpenHistory={() => setHistoryOpen(true)}
            />
          </div>
        ) : null}
        {historyOpen ? (
          <div className="absolute inset-0 overflow-y-auto bg-background">
            <HistoryScreen history={sites.history} onOpen={open} />
          </div>
        ) : null}
        {failedUrl !== null && !showingStart && !historyOpen ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background px-8 text-center">
            <p className="text-body text-foreground">
              {t("browser.loadFailed", { host: siteHost(failedUrl)?.host ?? t("browser.thisPage") })}
            </p>
            <button
              type="button"
              onClick={retry}
              className="min-h-11 rounded-lg bg-primary-fill px-5 text-label font-semibold text-background"
            >
              {t("browser.tryAgain")}
            </button>
          </div>
        ) : null}
      </div>

      {page && !editing ? (
        <div className="flex items-center gap-1 px-2 pt-1">
          <IconButton label={t("browser.backInPage")} onClick={goBackInPage} disabled={!nav?.canGoBack}><BackIcon /></IconButton>
          <IconButton label={t("browser.reload")} onClick={retry}><ReloadIcon /></IconButton>
          <IconButton
            label={saved ? t("browser.removeSaved") : t("browser.saveSite")}
            pressed={saved}
            onClick={toggleSaved}
            disabled={origin === null}
          >
            <StarIcon key={saved ? starPop : "off"} filled={saved} pop={saved && starPop > 0} />
          </IconButton>
          {grant && origin ? (
            <button
              type="button"
              onClick={() => onOpenConnectedApp(origin, currentUrl ?? origin)}
              className="ml-1 flex min-h-11 min-w-0 items-center gap-1.5 rounded-full bg-mist px-3.5 text-label font-semibold text-foreground"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-positive" />
              <span className="truncate">{t("browser.connected")}</span>
            </button>
          ) : null}
          <div className="flex-1" />
          <IconButton label={t("browser.close")} onClick={closePage}><CloseIcon /></IconButton>
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
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-muted active:bg-hover disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
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

function StarIcon({ filled, pop }: { filled: boolean; pop: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true" className={pop ? "gleam-star-pop" : undefined}>
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
