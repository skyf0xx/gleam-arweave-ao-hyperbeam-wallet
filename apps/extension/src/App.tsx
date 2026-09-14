import { useEffect, useState, type ReactNode } from "react";
import type { RuntimePort, ThemeSettings, WalletState, WalletSummary } from "@gleam/core";
import { OnboardingView } from "@/entrypoints/popup/onboarding/index.tsx";
import { UnlockView } from "@/entrypoints/popup/unlock/index.tsx";
import { MainScreenView } from "@/entrypoints/popup/main-screen/index.tsx";
import { SendView } from "@/entrypoints/popup/send/index.tsx";
import { ReceiveView } from "@/entrypoints/popup/receive/index.tsx";
import { ActivityView } from "@/entrypoints/popup/activity/index.tsx";
import { WalletSwitcherView } from "@/entrypoints/popup/wallet-switcher/index.tsx";
import { LockSettingsView } from "@/entrypoints/popup/lock-settings/index.tsx";
import { NetworkPeersView } from "@/entrypoints/popup/network-peers/index.tsx";

/**
 * The one shared shell mounted from every surface (popup, sidepanel,
 * and — once the provider-bridge layer lands — the approval window), per
 * core-design.md's Entrypoint layout.
 *
 * View-switch design (per ARCHITECTURE.md §1.3: "a validated view-name
 * string, NOT a router library"), resolved as this task's Correction
 * Protocol log assigned it here: a top-level `VIEWS` union drives which
 * top-level surface mounts —
 *
 *   "loading" | "onboarding" | "unlock" | "main-screen"
 *
 * — determined by calling `getState` on mount (no wallets stored ->
 * onboarding; wallets exist but no unlocked session -> unlock; an
 * unlocked session exists -> main-screen). `send`/`receive`/`activity`
 * are NOT additional entries in this top-level union — they're reached
 * as a nested view-switch one level down, inside the `main-screen`
 * branch only, exactly like `OnboardingView`'s own internal `Step` union
 * one level below the top switch. This mirrors the shape
 * `OnboardingView`/`UnlockView` already established (a view module owns
 * its own internal step state) rather than inventing a second pattern:
 * the top-level switch only ever cares about "which of the three
 * account-lifecycle states is the extension in," and everything reachable
 * once unlocked is main-screen's own concern.
 *
 * Re-derives `getState` again after onboarding/unlock complete (rather
 * than trusting the completing view's local assumption) so this
 * component is always driven by the same wire-contract read every other
 * consumer uses — no separate "I just unlocked, so I know I'm unlocked"
 * shortcut that could drift from what `getState` actually reports.
 *
 * `runtime` resolution: when no `runtime` prop is supplied (every real
 * mount site — `popup/index.tsx`/`sidepanel/index.tsx`, both `scaffold`'s
 * locked scope, neither passes one), the concrete `WebextCoreRuntimePort`
 * singleton (`./adapters/runtime`) is loaded via a *dynamic* `import()`
 * inside `useEffect`, not a static top-level import. `@webext-core/
 * messaging` unconditionally imports `webextension-polyfill` at module
 * load, and that polyfill throws synchronously ("This script should only
 * be loaded in a browser extension") the instant its module body runs
 * outside a real extension context — including under `scaffold`'s own
 * `App.scaffold.test.tsx`, which mounts `<App layout="popup" />` with no
 * `runtime` prop and no `@webext-core/messaging` mock. A static import
 * of the adapter would make every test that imports `App.tsx` crash at
 * collection time, not just tests that actually exercise the runtime
 * call — so the adapter is resolved lazily, and only once actually
 * needed (on mount, inside the effect that immediately calls
 * `getState`), never at module-evaluation time.
 */
export type AppLayout = "popup" | "sidepanel" | "approval";

export interface AppProps {
  layout: AppLayout;
  runtime?: RuntimePort;
}

type TopView = "loading" | "onboarding" | "unlock" | "main-screen";
type MainSubView =
  | { kind: "home" }
  | { kind: "send" }
  | { kind: "receive" }
  | { kind: "activity" }
  | { kind: "wallet-switcher" }
  | { kind: "lock-settings" }
  | { kind: "network-peers" };

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
  const [subView, setSubView] = useState<MainSubView>({ kind: "home" });
  const [resolvedRuntime, setResolvedRuntime] = useState<RuntimePort | null>(runtimeProp ?? null);
  const [initError, setInitError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeSettings["theme"]>("light");

  const refresh = async (runtime: RuntimePort) => {
    const state = await runtime.send<void, WalletState>({ type: "getState", payload: undefined });
    setView(resolveTopView(state));
    setWallet(resolveActiveWallet(state));
  };

  /**
   * Fetches the stored theme preference and applies it to the shared root
   * before the first substantive paint — see this task's inherited debt
   * note (no synchronous pre-paint read exists in MV3) and this file's
   * `hedgehog decision` record for why "await it alongside `getState` in
   * the same `init()` gate" was chosen over a flash-accepting default.
   * Never throws: a read failure (most likely today, since
   * `getThemePreference`/`setThemePreference` aren't registered against
   * `background/index.ts`'s dispatcher until `THEME-PREFERENCE-PROVIDER-
   * BRIDGE` lands) falls back to light — this intent's own default bias —
   * rather than blocking `init()` or leaving `data-theme` unset from a
   * throw.
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
        // unhandled rejection — HONESTY: never fail silently or crash
        // uncaught.
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
    // rather than crashing, per this task's HONESTY requirement.
    content = <div className="p-4 text-body text-muted">No active wallet found.</div>;
  } else if (subView.kind === "send") {
    content = (
      <SendView
        runtime={runtime}
        wallet={wallet}
        onBack={() => setSubView({ kind: "home" })}
        onDone={() => setSubView({ kind: "home" })}
      />
    );
  } else if (subView.kind === "receive") {
    content = <ReceiveView wallet={wallet} onBack={() => setSubView({ kind: "home" })} />;
  } else if (subView.kind === "activity") {
    content = <ActivityView runtime={runtime} wallet={wallet} onBack={() => setSubView({ kind: "home" })} />;
  } else if (subView.kind === "wallet-switcher") {
    content = (
      <WalletSwitcherView
        runtime={runtime}
        onSwitched={() => {
          setSubView({ kind: "home" });
          void refresh(runtime);
        }}
      />
    );
  } else if (subView.kind === "lock-settings") {
    content = (
      <LockSettingsView
        runtime={runtime}
        onBack={() => setSubView({ kind: "home" })}
        onLocked={() => void refresh(runtime)}
      />
    );
  } else if (subView.kind === "network-peers") {
    content = <NetworkPeersView runtime={runtime} onBack={() => setSubView({ kind: "home" })} />;
  } else {
    content = (
      <MainScreenView
        runtime={runtime}
        wallet={wallet}
        onSend={() => setSubView({ kind: "send" })}
        onReceive={() => setSubView({ kind: "receive" })}
        // No "all tokens" screen exists yet (tracked as separate scope,
        // matching this file's `activity` sub-view once that screen is
        // built) — a no-op keeps the header's affordance visually
        // complete without a destination view to route to yet.
        onViewAllTokens={() => {}}
        onViewAllActivity={() => setSubView({ kind: "activity" })}
        onOpenWalletSwitcher={() => setSubView({ kind: "wallet-switcher" })}
        onOpenLockSettings={() => setSubView({ kind: "lock-settings" })}
        onOpenNetworkPeers={() => setSubView({ kind: "network-peers" })}
      />
    );
  }

  return (
    <div
      data-layout={layout}
      data-theme={theme === "dark" ? "dark" : undefined}
      className="min-h-full bg-background text-foreground"
    >
      {content}
    </div>
  );
}

export default App;
