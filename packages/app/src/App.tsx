import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Toast } from "@gleam/ui/src/primitives/toast.tsx";
import { BackStackContext, createBackStack } from "@gleam/ui/src/primitives/back-stack.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vaultHasPassword, type RuntimePort, type ThemeSettings, type WalletState, type WalletSummary } from "@gleam/core";
import { GatedOnboarding } from "./screens/onboarding/index.tsx";
import { UnlockView } from "./screens/unlock/index.tsx";
import {
  AddressIdentityProvider,
  loadAddressIdentityKey,
  makeAddressIdentity,
  NO_ADDRESS_IDENTITY_KEY,
  type AddressIdentityKey,
} from "./address-identity";
import { type MainScreenTab } from "./screens/main-screen/index.tsx";
import { useT } from "./i18n";
import { LocalizedRoot } from "./i18n/LocalizedRoot";
import { usePlatform } from "./app-platform/context";
import { ApprovalSheet } from "./approval/ApprovalSheet";
import { QueryCachePersistence } from "./query-cache/persistence";
import { forgetQueryCache, sweepQueryCache } from "./query-cache/sweep";
import { errorText } from "./i18n/errors";
import { applyStoredTheme, Sky, ThemeContext, themeAttribute } from "./theme";
import { releasePointerFocusOnBlur } from "./pointer-focus";
import { resolveActiveWallet, resolveTopView, type MainSubView, type TopView } from "./app-views";
import { SubViewContent } from "./SubViewContent";

/**
 * The one shared shell mounted from the popup and the side panel (the
 * approval window mounts `ApprovalRoot`, which has its own request-driven
 * state machine).
 *
 * A top-level `TopView` union drives which top-level surface mounts —
 *
 *   "loading" | "onboarding" | "unlock" | "main-screen"
 *
 * — determined by calling `getState` on mount (no wallets stored ->
 * onboarding; wallets exist but no unlocked session -> unlock; an
 * unlocked session exists -> main-screen). `send`/`receive`/`activity`
 * are NOT additional entries in this top-level union — they're reached
 * as a nested view-switch one level down, inside the `main-screen`
 * branch only, mirroring `OnboardingView`'s own internal `Step` union: a
 * view module owns its own internal step state, and the top-level switch
 * only ever cares about which of the three account-lifecycle states the
 * wallet is in.
 *
 * Re-derives `getState` again after onboarding/unlock complete (rather
 * than trusting the completing view's local assumption) so this
 * component is always driven by the same wire-contract read every other
 * consumer uses — no separate "I just unlocked, so I know I'm unlocked"
 * shortcut that could drift from what `getState` actually reports.
 *
 * The `RuntimePort` comes from `AppPlatform.runtime`; the `runtime` prop
 * replaces it, which tests use to stub the background.
 */
export type AppLayout = "popup" | "sidepanel" | "phone";

export interface AppProps {
  layout: AppLayout;
  runtime?: RuntimePort;
}

/**
 * One `QueryClient` per extension document (popup, sidepanel, approval each
 * get their own JS runtime, so this is intentionally not a cross-context
 * singleton) — module-scoped so remounts within the same document (e.g. a
 * test that renders `<App />` more than once) share one cache rather than
 * each constructing their own.
 */
const queryClient = new QueryClient();

const NOTICE_MS = 6000;

function App(props: AppProps) {
  return (
    <LocalizedRoot>
      <AppContent {...props} />
    </LocalizedRoot>
  );
}

function AppContent({ layout, runtime: runtimeProp }: AppProps) {
  const platform = usePlatform();
  const t = useT();
  const runtime = runtimeProp ?? platform.runtime;
  const [view, setView] = useState<TopView>("loading");
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [wallets, setWallets] = useState<WalletSummary[]>([]);
  const [subView, setSubView] = useState<MainSubView>({ kind: "home" });
  const [homeTab, setHomeTab] = useState<MainScreenTab>("tokens");
  const [initError, setInitError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeSettings["theme"]>("light");
  const [identityKey, setIdentityKey] = useState<AddressIdentityKey>(NO_ADDRESS_IDENTITY_KEY);
  const [backStack] = useState(createBackStack);
  const [layoutRoot, setLayoutRoot] = useState<HTMLDivElement | null>(null);

  // The home screen scrolls the window, so a screen opened from far down
  // it (Points sits below the tokens) would start at that offset. Reset
  // before paint; going back home keeps the old behavior.
  useLayoutEffect(() => {
    if (subView.kind !== "home") window.scrollTo?.(0, 0);
  }, [subView.kind]);

  // A browse link waits here while the wallet is locked or still loading,
  // and opens once the main screen is up.
  const [browseLink, setBrowseLink] = useState<{ url: string; id: number } | null>(null);
  const browseLinkCount = useRef(0);
  const subscribeBrowseLinks = platform.capabilities.dappBrowser ? platform.browseLinks?.subscribe : undefined;
  useEffect(() => subscribeBrowseLinks?.((url) => setBrowseLink({ url, id: ++browseLinkCount.current })), [subscribeBrowseLinks]);
  useEffect(() => {
    if (browseLink === null || view !== "main-screen") return;
    setSubView({ kind: "browser", url: browseLink.url, linkId: browseLink.id });
    setBrowseLink(null);
  }, [browseLink, view]);

  const [notice, setNotice] = useState<string | null>(null);
  const subscribeNotices = platform.notices?.subscribe;
  useEffect(() => subscribeNotices?.(setNotice), [subscribeNotices]);
  useEffect(() => releasePointerFocusOnBlur(), []);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Every back arrow on screen and every overlay registers with the stack, so
  // the system back press undoes what a tap on Back would. Unhandled, the
  // shell minimises, which is the right thing to do from the home screen.
  const subscribeBack = platform.backButton?.subscribe;
  useEffect(() => subscribeBack?.(() => backStack.handle()), [subscribeBack, backStack]);

  const refresh = async (runtime: RuntimePort) => {
    const state = await runtime.send<void, WalletState>({ type: "getState", payload: undefined });
    const top = resolveTopView(state);
    setView(top);
    // The browser opens on its start screen after a lock, not on the last page.
    if (top !== "main-screen") setSubView((current) => (current.kind === "browser" ? { kind: "home" } : current));
    setWallet(resolveActiveWallet(state));
    setWallets(state.wallets);
  };

  /**
   * Applies the stored theme before the first substantive paint. No
   * synchronous pre-paint read exists in MV3, so this awaits alongside
   * `getState` in the same `init()` gate rather than accepting a flash of
   * the wrong theme.
   */
  const applyTheme = (runtime: RuntimePort) => applyStoredTheme(runtime, setTheme);

  useEffect(() => {
    let cancelled = false;
    // Defends against the same class of issue `cancelled` normally
    // covers, for callers that mount `App` without ever unmounting it
    // (e.g. a test that renders and asserts synchronously with no
    // `cleanup()`/`unmount()` call) — this component's async reads
    // must never throw an uncaught rejection or schedule a state update
    // against a DOM that's already gone.
    const isEnvironmentLive = () => cancelled === false && typeof document !== "undefined";

    async function init() {
      try {
        // Avatars are seeded from the security phrase, so it loads before
        // the first paint rather than redrawing them a moment later.
        await Promise.all([refresh(runtime), applyTheme(runtime), loadAddressIdentityKey(runtime).then(setIdentityKey)]);
      } catch (error) {
        if (!isEnvironmentLive()) return;
        // A resolution/read failure this early (no extension messaging
        // context available, or the background service worker
        // unreachable) is surfaced as a named state rather than an
        // unhandled rejection: never fail silently or crash uncaught.
        setInitError(errorText(error));
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
    // Init once, on mount, regardless of a later `runtimeProp`
    // identity change — mirrors ApprovalRoot.tsx's same one-time-init shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A stored biometric password outlives the vault it opened once the last
  // keyfile wallet is removed (and, on iOS, an uninstall), so it is
  // dropped rather than kept.
  const vaultWithoutPassword = view !== "loading" && initError === null && !vaultHasPassword(wallets);
  useEffect(() => {
    if (!vaultWithoutPassword || !platform.capabilities.biometrics) return;
    platform.biometrics.remove().catch((error: unknown) => console.error("Couldn't remove the biometric unlock.", error));
  }, [vaultWithoutPassword, platform]);

  // Every stored cache whose wallet is gone is swept once the list loads,
  // which also catches one a second surface wrote back after a removal,
  // or one left by a reset in an approval window. This runs after the
  // persistence for a removed active wallet has unmounted, so its pending
  // save can't write the cache back here. A wallet removed while this
  // surface is open also leaves the in-memory client.
  const knownWalletsRef = useRef<WalletSummary[]>([]);
  useEffect(() => {
    if (view === "loading" || initError !== null) return;
    const current = new Set(wallets.map((candidate) => candidate.id));
    for (const known of knownWalletsRef.current) {
      if (!current.has(known.id) && !wallets.some((candidate) => candidate.address === known.address)) {
        queryClient.removeQueries({ queryKey: [known.address] });
      }
    }
    knownWalletsRef.current = wallets;
    void sweepQueryCache(platform.queryCache, current);
  }, [view, initError, wallets, platform]);

  const addressIdentity = useMemo(
    () => makeAddressIdentity(identityKey, () => void loadAddressIdentityKey(runtime).then(setIdentityKey)),
    [identityKey, runtime],
  );

  const themeContext = useMemo(() => ({ theme, setTheme }), [theme]);

  let content: ReactNode;

  if (initError) {
    content = <div className="p-4 text-body text-muted">{t("app.initError", { error: initError })}</div>;
  } else if (view === "loading") {
    content = <div className="p-4 text-body text-muted">{t("app.loading")}</div>;
  } else if (view === "onboarding") {
    content = <GatedOnboarding
        runtime={runtime}
        onComplete={() => void refresh(runtime)}
        gateEnabled={platform.buildInfo.foundingGate}
      />;
  } else if (view === "unlock") {
    content = (
      <UnlockView
        runtime={runtime}
        onUnlocked={() => void refresh(runtime)}
        onResetComplete={() => {
          queryClient.clear();
          void forgetQueryCache(platform.queryCache.clear());
          void refresh(runtime);
        }}
      />
    );
  } else if (!wallet) {
    // `main-screen` resolved with no active wallet to show — a `getState`
    // response the current models can't actually produce (wallets.length
    // > 0 is what got us into this branch), kept as a named fallback
    // rather than crashing.
    content = <div className="p-4 text-body text-muted">{t("app.noActiveWallet")}</div>;
  } else {
    content = (
      <SubViewContent
        subView={subView}
        setSubView={setSubView}
        runtime={runtime}
        wallet={wallet}
        wallets={wallets}
        setWallets={setWallets}
        refresh={refresh}
        layoutRoot={layoutRoot}
        homeTab={homeTab}
        setHomeTab={setHomeTab}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BackStackContext.Provider value={backStack}>
      <AddressIdentityProvider value={addressIdentity}>
      <ThemeContext.Provider value={themeContext}>
        <div
          ref={setLayoutRoot}
          data-layout={layout}
          data-theme={themeAttribute(theme)}
          className="min-h-full bg-background text-foreground silica:isolate"
        >
          {theme === "silica" ? <Sky /> : null}
          {view === "main-screen" && wallet && !initError ? (
            <QueryCachePersistence
              key={wallet.id}
              client={queryClient}
              port={platform.queryCache}
              walletId={wallet.id}
              address={wallet.address}
              buster={platform.buildInfo.version}
            >
              {content}
            </QueryCachePersistence>
          ) : (
            content
          )}
          {notice !== null ? <Toast message={notice} multiline className="fixed bottom-[calc(0.875rem+var(--safe-bottom))] z-40" /> : null}
          {platform.approvalSheet ? <ApprovalSheet port={platform.approvalSheet} container={layoutRoot} /> : null}
        </div>
      </ThemeContext.Provider>
      </AddressIdentityProvider>
      </BackStackContext.Provider>
    </QueryClientProvider>
  );
}

export default App;
