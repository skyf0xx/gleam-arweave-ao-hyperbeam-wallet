import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RuntimePort, ThemeSettings, TokenBalance, WalletState, WalletSummary } from "@gleam/core";
import { OnboardingView } from "@/entrypoints/popup/onboarding/index.tsx";
import { UnlockView } from "@/entrypoints/popup/unlock/index.tsx";
import { MainScreenView } from "@/entrypoints/popup/main-screen/index.tsx";
import { SendView } from "@/entrypoints/popup/send/index.tsx";
import { ReceiveView } from "@/entrypoints/popup/receive/index.tsx";
import { WalletSwitcherView } from "@/entrypoints/popup/wallet-switcher/index.tsx";
import { WalletDetailView } from "@/entrypoints/popup/wallet-detail/index.tsx";
import { LockSettingsView } from "@/entrypoints/popup/lock-settings/index.tsx";
import { NetworkPeersView } from "@/entrypoints/popup/network-peers/index.tsx";
import { SettingsHomeView } from "@/entrypoints/popup/settings-home/index.tsx";
import { ConnectedAppsView } from "@/entrypoints/popup/connected-apps/index.tsx";
import { ManageTokensView } from "@/entrypoints/popup/manage-tokens/index.tsx";

/**
 * The one shared shell mounted from every surface (popup, sidepanel, and
 * the approval window).
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
 * extension is in.
 *
 * Re-derives `getState` again after onboarding/unlock complete (rather
 * than trusting the completing view's local assumption) so this
 * component is always driven by the same wire-contract read every other
 * consumer uses — no separate "I just unlocked, so I know I'm unlocked"
 * shortcut that could drift from what `getState` actually reports.
 *
 * `runtime` resolution: when no `runtime` prop is supplied (every real
 * mount site — `popup/index.tsx`/`sidepanel/index.tsx`), the concrete
 * `WebextCoreRuntimePort` singleton (`./adapters/runtime`) is loaded via
 * a *dynamic* `import()` inside `useEffect`, not a static top-level
 * import. `@webext-core/messaging` unconditionally imports
 * `webextension-polyfill` at module load, and that polyfill throws
 * synchronously ("This script should only be loaded in a browser
 * extension") the instant its module body runs outside a real extension
 * context — including under a test that mounts `<App layout="popup" />`
 * with no `runtime` prop and no `@webext-core/messaging` mock. A static
 * import of the adapter would make every test that imports `App.tsx`
 * crash at collection time, not just tests that actually exercise the
 * runtime call — so the adapter is resolved lazily, only once actually
 * needed (on mount, inside the effect that immediately calls
 * `getState`), never at module-evaluation time.
 */
export type AppLayout = "popup" | "sidepanel" | "approval";

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

type TopView = "loading" | "onboarding" | "unlock" | "main-screen";
type MainSubView =
  | { kind: "home" }
  /** `token: null` is the AR path (the top-level Send action); an AO token row's click carries its `TokenBalance`. */
  | { kind: "send"; token: TokenBalance | null }
  | { kind: "receive" }
  | { kind: "wallet-switcher" }
  | { kind: "wallet-detail"; walletId: string }
  | { kind: "add-wallet" }
  | { kind: "settings-home" }
  | { kind: "lock-settings" }
  | { kind: "network-peers" }
  | { kind: "connected-apps" }
  | { kind: "manage-tokens" };

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

export function App({ layout, runtime: runtimeProp }: AppProps) {
  const [view, setView] = useState<TopView>("loading");
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [wallets, setWallets] = useState<WalletSummary[]>([]);
  const [subView, setSubView] = useState<MainSubView>({ kind: "home" });
  const [resolvedRuntime, setResolvedRuntime] = useState<RuntimePort | null>(runtimeProp ?? null);
  const [initError, setInitError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeSettings["theme"]>("light");

  const refresh = async (runtime: RuntimePort) => {
    const state = await runtime.send<void, WalletState>({ type: "getState", payload: undefined });
    setView(resolveTopView(state));
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
    // `MainScreenView`'s theme toggle sets `data-theme="dark"` directly on
    // `document.documentElement` (see that file's doc comment) so the
    // running surface reflects a change immediately with no storage-change
    // listener. That write outlives the component that made it — a
    // sidepanel/approval document that stays alive across view transitions
    // keeps whatever `documentElement` attribute the last toggle left, and
    // `[data-theme="dark"]` matches any ancestor, so a stale attribute here
    // would force dark styling on every view, including this shell's own
    // onboarding/unlock screens, regardless of the actual stored
    // preference. Resetting it here, from the same read this component
    // already uses to drive its own root `data-theme`, keeps the two in
    // sync instead of trusting whatever the document happened to be left
    // at.
    try {
      const settings = await runtime.send<void, ThemeSettings>({
        type: "getThemePreference",
        payload: undefined,
      });
      setTheme(settings.theme);
      if (settings.theme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    } catch {
      setTheme("light");
      document.documentElement.removeAttribute("data-theme");
    }
  };

  useEffect(() => {
    let cancelled = false;
    // Defends against the same class of issue `cancelled` normally
    // covers, for callers that mount `App` without ever unmounting it
    // (e.g. a test that renders and asserts synchronously with no
    // `cleanup()`/`unmount()` call) — this component's async resolution
    // must never throw an uncaught rejection or schedule a state update
    // against a DOM that's already gone by the time the dynamic
    // `import()` above resolves.
    const isEnvironmentLive = () => cancelled === false && typeof document !== "undefined";

    async function init() {
      try {
        // See this component's doc comment: the concrete adapter is only
        // ever dynamically imported here, never at module scope.
        const runtime = runtimeProp ?? (await import("./adapters/runtime")).runtimePort;
        if (!isEnvironmentLive()) return;
        setResolvedRuntime(runtime);
        await Promise.all([refresh(runtime), applyTheme(runtime)]);
      } catch (error) {
        if (!isEnvironmentLive()) return;
        // A resolution/read failure this early (no extension messaging
        // context available, or the background service worker
        // unreachable) is surfaced as a named state rather than an
        // unhandled rejection: never fail silently or crash uncaught.
        setInitError(error instanceof Error ? error.message : String(error));
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
    // Resolve the runtime once, on mount, regardless of a later `runtimeProp`
    // identity change — mirrors ApprovalRoot.tsx's same one-time-init shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runtime = resolvedRuntime;

  let content: ReactNode;

  if (initError) {
    content = <div className="p-4 text-body text-muted">Couldn&apos;t reach the extension background. {initError}</div>;
  } else if (view === "loading" || runtime === null) {
    content = <div className="p-4 text-body text-muted">Loading&hellip;</div>;
  } else if (view === "onboarding") {
    content = <OnboardingView runtime={runtime} onComplete={() => void refresh(runtime)} />;
  } else if (view === "unlock") {
    content = (
      <UnlockView
        runtime={runtime}
        onUnlocked={() => void refresh(runtime)}
        onResetComplete={() => void refresh(runtime)}
      />
    );
  } else if (!wallet) {
    // `main-screen` resolved with no active wallet to show — a `getState`
    // response the current models can't actually produce (wallets.length
    // > 0 is what got us into this branch), kept as a named fallback
    // rather than crashing.
    content = <div className="p-4 text-body text-muted">No active wallet found.</div>;
  } else if (subView.kind === "send") {
    content = (
      <SendView
        runtime={runtime}
        wallet={wallet}
        token={subView.token}
        onBack={() => setSubView({ kind: "home" })}
        onDone={() => setSubView({ kind: "home" })}
      />
    );
  } else if (subView.kind === "receive") {
    content = <ReceiveView wallet={wallet} onBack={() => setSubView({ kind: "home" })} />;
  } else if (subView.kind === "wallet-switcher") {
    content = (
      <WalletSwitcherView
        runtime={runtime}
        onSwitched={() => {
          setSubView({ kind: "home" });
          void refresh(runtime);
        }}
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
        onRenamed={() => {
          setSubView({ kind: "wallet-switcher" });
          void refresh(runtime);
        }}
        onRemoved={() => {
          setSubView({ kind: "home" });
          void refresh(runtime);
        }}
      />
    ) : (
      <div className="p-4 text-body text-muted">Wallet not found.</div>
    );
  } else if (subView.kind === "add-wallet") {
    content = (
      <OnboardingView
        runtime={runtime}
        mode="add-wallet"
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
        onOpenLockSettings={() => setSubView({ kind: "lock-settings" })}
        onOpenConnectedApps={() => setSubView({ kind: "connected-apps" })}
        onOpenNetworkPeers={() => setSubView({ kind: "network-peers" })}
        onOpenManageTokens={() => setSubView({ kind: "manage-tokens" })}
      />
    );
  } else if (subView.kind === "lock-settings") {
    content = (
      <LockSettingsView
        runtime={runtime}
        onBack={() => setSubView({ kind: "settings-home" })}
        onLocked={() => void refresh(runtime)}
      />
    );
  } else if (subView.kind === "network-peers") {
    content = <NetworkPeersView runtime={runtime} onBack={() => setSubView({ kind: "settings-home" })} />;
  } else if (subView.kind === "connected-apps") {
    content = <ConnectedAppsView runtime={runtime} onBack={() => setSubView({ kind: "settings-home" })} />;
  } else if (subView.kind === "manage-tokens") {
    content = (
      <ManageTokensView
        runtime={runtime}
        address={wallet.address}
        onBack={() => setSubView({ kind: "settings-home" })}
      />
    );
  } else {
    content = (
      <MainScreenView
        runtime={runtime}
        wallet={wallet}
        onSend={() => setSubView({ kind: "send", token: null })}
        onSendToken={(token) => setSubView({ kind: "send", token })}
        onReceive={() => setSubView({ kind: "receive" })}
        onOpenWalletSwitcher={() => setSubView({ kind: "wallet-switcher" })}
        onOpenSettings={() => setSubView({ kind: "settings-home" })}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div
        data-layout={layout}
        data-theme={theme === "dark" ? "dark" : undefined}
        className="min-h-full bg-background text-foreground"
      >
        {content}
      </div>
    </QueryClientProvider>
  );
}

export default App;
