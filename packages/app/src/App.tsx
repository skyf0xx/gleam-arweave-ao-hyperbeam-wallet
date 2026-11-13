import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Toast } from "@gleam/ui/src/primitives/toast.tsx";
import { BackStackContext, createBackStack } from "@gleam/ui/src/primitives/back-stack.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vaultHasPassword, type Collectible, type PermissionType, type RuntimePort, type ThemeSettings, type TokenBalance, type WalletState, type WalletSummary } from "@gleam/core";
import { ExistingMemberReveal, GatedOnboarding, OnboardingView, PendingClaim } from "./screens/onboarding/index.tsx";
import { UnlockView } from "./screens/unlock/index.tsx";
import {
  AddressIdentityProvider,
  loadAddressIdentityKey,
  makeAddressIdentity,
  NO_ADDRESS_IDENTITY_KEY,
  type AddressIdentityKey,
} from "./address-identity";
import { CollectibleDetailView } from "./screens/collectibles/index.tsx";
import { MainScreenView, type MainScreenTab } from "./screens/main-screen/index.tsx";
import { SendCollectibleView, SendView } from "./screens/send/index.tsx";
import { ReceiveView } from "./screens/receive/index.tsx";
import { WalletSwitcherView } from "./screens/wallet-switcher/index.tsx";
import { WalletDetailView } from "./screens/wallet-detail/index.tsx";
import { LockSettingsView } from "./screens/lock-settings/index.tsx";
import { BackupView } from "./screens/backup/index.tsx";
import { NetworkPeersView } from "./screens/network-peers/index.tsx";
import { AppearanceView, SettingsHomeView } from "./screens/settings-home/index.tsx";
import { BrowserView } from "./screens/browser/index.tsx";
import { ConnectedAppsView } from "./screens/connected-apps/index.tsx";
import { ManageTokensView } from "./screens/manage-tokens/index.tsx";
import { DisplayCurrencyView } from "./screens/display-currency/index.tsx";
import { HomeScreenView } from "./screens/home-screen/index.tsx";
import { LanguageView } from "./screens/language/index.tsx";
import { useT } from "./i18n";
import { LocalizedRoot } from "./i18n/LocalizedRoot";
import { PointsView } from "./screens/points/index.tsx";
import { UseGleamOnSiteView } from "./screens/site-wallet/index.tsx";
import { usePlatform } from "./app-platform/context";
import { ApprovalSheet } from "./approval/ApprovalSheet";
import { QueryCachePersistence } from "./query-cache/persistence";
import { forgetQueryCache, sweepQueryCache } from "./query-cache/sweep";
import { sitePageUrl } from "@gleam/core";
import { errorText } from "./i18n/errors";
import { applyDocumentTheme, ThemeContext } from "./theme";
import { releasePointerFocusOnBlur } from "./pointer-focus";

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

type TopView = "loading" | "onboarding" | "unlock" | "main-screen";
type MainSubView =
  /** `editTokens` reopens the token list in edit mode, where add-token was opened from. */
  | { kind: "home"; editTokens?: boolean }
  /** `token: null` is the AR path (the top-level Send action); an AO token row's click carries its `TokenBalance`. */
  | { kind: "send"; token: TokenBalance | null; recipient?: string }
  | { kind: "receive" }
  | { kind: "wallet-switcher" }
  | { kind: "wallet-detail"; walletId: string }
  | { kind: "add-wallet" }
  | { kind: "settings-home" }
  | { kind: "appearance" }
  | { kind: "lock-settings" }
  | { kind: "backup" }
  | { kind: "network-peers" }
  | { kind: "browser"; url?: string }
  /** `origin` is the site whose entry to show; `returnToUrl` is the browser page to go back to. */
  | { kind: "connected-apps"; origin?: string; returnToUrl?: string }
  | { kind: "manage-tokens" }
  | { kind: "display-currency" }
  | { kind: "home-screen" }
  | { kind: "language" }
  | { kind: "collectible"; collectible: Collectible }
  | { kind: "send-collectible"; collectible: Collectible }
  | { kind: "points" }
  | { kind: "use-gleam-on-site"; origin: string; favIconUrl: string | null; requestedPermissions: PermissionType[] };

function resolveTopView(state: WalletState): TopView {
  if (state.wallets.length === 0) return "onboarding";
  if (state.session === null || state.session.unlockedWalletIds.length === 0) return "unlock";
  return "main-screen";
}

function resolveActiveWallet(state: WalletState): WalletSummary | null {
  const unlockedId = state.session?.unlockedWalletIds[0] ?? null;
  const preferredId = state.activeWalletId ?? unlockedId;
  return state.wallets.find((wallet) => wallet.id === preferredId) ?? state.wallets[0] ?? null;
}

export function App(props: AppProps) {
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
   * Fetches the stored theme preference and applies it to the shared root
   * before the first substantive paint. No synchronous pre-paint read
   * exists in MV3, so this awaits alongside `getState` in the same
   * `init()` gate rather than accepting a flash of the wrong theme.
   * Never throws: a read failure falls back to light rather than
   * blocking `init()` or leaving `data-theme` unset.
   */
  const applyTheme = async (runtime: RuntimePort) => {
    // A document that outlives a view keeps whatever `documentElement`
    // attribute the last toggle left, and `[data-theme="dark"]` matches any
    // ancestor, so reset it from the stored preference rather than trust it.
    let stored: ThemeSettings["theme"] = "light";
    try {
      const settings = await runtime.send<void, ThemeSettings>({
        type: "getThemePreference",
        payload: undefined,
      });
      stored = settings.theme;
    } catch {
      // Falls back to light.
    }
    setTheme(stored);
    applyDocumentTheme(stored);
  };

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
  } else if (subView.kind === "send") {
    content = (
      <SendView
        runtime={runtime}
        wallet={wallet}
        token={subView.token}
        recipient={subView.recipient}
        onBack={() => setSubView({ kind: "home" })}
        onDone={() => setSubView({ kind: "home" })}
      />
    );
  } else if (subView.kind === "collectible") {
    content = (
      <CollectibleDetailView
        collectible={subView.collectible}
        onBack={() => setSubView({ kind: "home" })}
        onSend={(collectible) => setSubView({ kind: "send-collectible", collectible })}
      />
    );
  } else if (subView.kind === "send-collectible") {
    const { collectible } = subView;
    content = (
      <SendCollectibleView
        runtime={runtime}
        wallet={wallet}
        collectible={collectible}
        onBack={() => setSubView({ kind: "collectible", collectible })}
        onDone={() => setSubView({ kind: "home" })}
      />
    );
  } else if (subView.kind === "points") {
    content = <PointsView runtime={runtime} wallet={wallet} onBack={() => setSubView({ kind: "home" })} />;
  } else if (subView.kind === "receive") {
    content = <ReceiveView wallet={wallet} onBack={() => setSubView({ kind: "home" })} />;
  } else if (subView.kind === "wallet-switcher") {
    content = (
      <WalletSwitcherView
        runtime={runtime}
        initialWallets={wallets}
        initialActiveWalletId={wallet?.id ?? null}
        onSwitched={() => void refresh(runtime)}
        onBack={() => setSubView({ kind: "home" })}
        onAddWallet={() => setSubView({ kind: "add-wallet" })}
        onManage={(walletId) => setSubView({ kind: "wallet-detail", walletId })}
      />
    );
  } else if (subView.kind === "wallet-detail") {
    const detailWallet = wallets.find((candidate) => candidate.id === subView.walletId) ?? null;
    content = detailWallet ? (
      <WalletDetailView
        runtime={runtime}
        wallet={detailWallet}
        onBack={() => setSubView({ kind: "wallet-switcher" })}
        onRenamed={() => void refresh(runtime)}
        onRemoved={() => {
          const remaining = wallets.filter((candidate) => candidate.id !== detailWallet.id);
          // Drop it now so the list doesn't flash the removed wallet. With none
          // left, refresh switches to onboarding, which should finish on home.
          setWallets(remaining);
          setSubView(remaining.length > 0 ? { kind: "wallet-switcher" } : { kind: "home" });
          void refresh(runtime);
        }}
      />
    ) : (
      <div className="p-4 text-body text-muted">{t("app.walletNotFound")}</div>
    );
  } else if (subView.kind === "add-wallet") {
    content = (
      <OnboardingView
        runtime={runtime}
        mode="add-wallet"
        vaultHasPassword={vaultHasPassword(wallets)}
        claim={platform.buildInfo.foundingGate ? "founding" : "open"}
        onCancel={() => setSubView({ kind: "wallet-switcher" })}
        onComplete={() => {
          setSubView({ kind: "home" });
          void refresh(runtime);
        }}
      />
    );
  } else if (subView.kind === "settings-home") {
    content = (
      <SettingsHomeView
        runtime={runtime}
        onBack={() => setSubView({ kind: "home" })}
        onOpenLockSettings={vaultHasPassword(wallets) ? () => setSubView({ kind: "lock-settings" }) : undefined}
        onOpenConnectedApps={() => setSubView({ kind: "connected-apps" })}
        onOpenAppearance={() => setSubView({ kind: "appearance" })}
        onOpenNetworkPeers={() => setSubView({ kind: "network-peers" })}
        onOpenFeedback={() =>
          window.open(sitePageUrl("feedback", platform.buildInfo.version), "_blank", "noopener,noreferrer")
        }
      />
    );
  } else if (subView.kind === "appearance") {
    content = (
      <AppearanceView
        runtime={runtime}
        onBack={() => setSubView({ kind: "settings-home" })}
        onOpenDisplayCurrency={() => setSubView({ kind: "display-currency" })}
        onOpenLanguage={() => setSubView({ kind: "language" })}
        onOpenHomeScreen={() => setSubView({ kind: "home-screen" })}
      />
    );
  } else if (subView.kind === "backup") {
    content = <BackupView runtime={runtime} onBack={() => setSubView({ kind: "lock-settings" })} />;
  } else if (subView.kind === "lock-settings") {
    content = (
      <LockSettingsView
        runtime={runtime}
        onBack={() => setSubView({ kind: "settings-home" })}
        onLocked={() => void refresh(runtime)}
        onSetUpPasskey={platform.capabilities.passkey ? () => platform.unlock.openPasskeyWindow("setup") : undefined}
        biometrics={platform.capabilities.biometrics ? platform.biometrics : undefined}
        lockOnSystemLock={platform.capabilities.lockOnSystemLock}
        backup={
          platform.capabilities.cloudBackup
            ? { provider: platform.capabilities.cloudBackup, open: () => setSubView({ kind: "backup" }) }
            : undefined
        }
      />
    );
  } else if (subView.kind === "network-peers") {
    content = <NetworkPeersView runtime={runtime} onBack={() => setSubView({ kind: "settings-home" })} />;
  } else if (subView.kind === "connected-apps") {
    const { origin, returnToUrl } = subView;
    content = (
      <ConnectedAppsView
        runtime={runtime}
        highlightOrigin={origin}
        wallets={wallets}
        onBack={() => setSubView(returnToUrl ? { kind: "browser", url: returnToUrl } : { kind: "settings-home" })}
      />
    );
  } else if (subView.kind === "browser") {
    content = (
      <BrowserView
        runtime={runtime}
        initialUrl={subView.url}
        onBack={() => setSubView({ kind: "home" })}
        onOpenConnectedApp={(origin, url) => setSubView({ kind: "connected-apps", origin, returnToUrl: url })}
        onLocked={() => void refresh(runtime)}
      />
    );
  } else if (subView.kind === "manage-tokens") {
    content = (
      <ManageTokensView
        runtime={runtime}
        address={wallet.address}
        onBack={() => setSubView({ kind: "home", editTokens: true })}
      />
    );
  } else if (subView.kind === "display-currency") {
    content = <DisplayCurrencyView runtime={runtime} onBack={() => setSubView({ kind: "appearance" })} />;
  } else if (subView.kind === "home-screen") {
    content = <HomeScreenView runtime={runtime} onBack={() => setSubView({ kind: "appearance" })} />;
  } else if (subView.kind === "language") {
    content = <LanguageView onBack={() => setSubView({ kind: "appearance" })} />;
  } else if (subView.kind === "use-gleam-on-site") {
    content = (
      <UseGleamOnSiteView
        runtime={runtime}
        origin={subView.origin}
        favIconUrl={subView.favIconUrl}
        requestedPermissions={subView.requestedPermissions}
        onBack={() => setSubView({ kind: "home" })}
        onDone={() => setSubView({ kind: "home" })}
      />
    );
  } else {
    content = (
      <PendingClaim runtime={runtime} wallet={wallet}>
        <ExistingMemberReveal runtime={runtime} wallet={wallet} enabled={platform.buildInfo.foundingGate}>
          <MainScreenView
            runtime={runtime}
            wallet={wallet}
            onSend={() => setSubView({ kind: "send", token: null })}
            onSendToken={(token) => setSubView({ kind: "send", token })}
            onSendTo={(recipient, token) => setSubView({ kind: "send", token, recipient })}
            sheetContainer={layoutRoot}
            onReceive={() => setSubView({ kind: "receive" })}
            onOpenWalletSwitcher={() => setSubView({ kind: "wallet-switcher" })}
            onOpenSettings={() => setSubView({ kind: "settings-home" })}
            onOpenPoints={() => setSubView({ kind: "points" })}
            onOpenBrowser={platform.capabilities.dappBrowser ? () => setSubView({ kind: "browser" }) : undefined}
            onUseGleamOnSite={(site) => setSubView({ kind: "use-gleam-on-site", ...site })}
            onOpenCollectible={(collectible) => setSubView({ kind: "collectible", collectible })}
            onAddToken={() => setSubView({ kind: "manage-tokens" })}
            initialTokenEditing={subView.kind === "home" && subView.editTokens}
            initialTab={homeTab}
            onTabChange={setHomeTab}
          />
        </ExistingMemberReveal>
      </PendingClaim>
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
          data-theme={theme === "dark" ? "dark" : undefined}
          className="min-h-full bg-background text-foreground"
        >
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
