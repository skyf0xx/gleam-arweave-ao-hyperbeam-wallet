import { useCallback, useEffect, useState } from "react";
import type { AutoLockTimeout, LockSettings, NetworkSettings, RuntimePort, ThemePreference, ThemeSettings } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";

const TIMEOUT_LABELS: Record<AutoLockTimeout, string> = {
  never: "Never",
  immediate: "Immediately",
  "5min": "5 minutes",
  "1hr": "1 hour",
  "4hr": "4 hours",
};

function gatewayHostname(gatewayUrl: string): string {
  try {
    return new URL(gatewayUrl).hostname;
  } catch {
    return gatewayUrl;
  }
}

/**
 * Settings home (settings-screens-gap follow-up) — the dedicated settings
 * screen the gear icon opens, replacing `MainScreenView`'s small inline
 * menu now that enough destination screens exist to justify one: grouped
 * WALLET/NETWORK/GENERAL sections of navigable rows, each showing its
 * current value on the right, matching the reference mockup. "Import &
 * export" and "About" have no screen built yet, so those two rows render
 * disabled rather than routing nowhere.
 */
export interface SettingsHomeViewProps {
  runtime: RuntimePort;
  onBack: () => void;
  onOpenLockSettings: () => void;
  onOpenConnectedApps: () => void;
  onOpenNetworkPeers: () => void;
}

interface LoadState {
  lockSettings: LockSettings | null;
  networkSettings: NetworkSettings | null;
  loading: boolean;
}

export function SettingsHomeView({
  runtime,
  onBack,
  onOpenLockSettings,
  onOpenConnectedApps,
  onOpenNetworkPeers,
}: SettingsHomeViewProps) {
  const [state, setState] = useState<LoadState>({ lockSettings: null, networkSettings: null, loading: true });
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [savingTheme, setSavingTheme] = useState(false);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    const [lockSettings, networkSettings, themeSettings] = await Promise.allSettled([
      runtime.send<void, LockSettings>({ type: "getLockSettings", payload: undefined }),
      runtime.send<void, NetworkSettings>({ type: "getNetworkSettings", payload: undefined }),
      runtime.send<void, ThemeSettings>({ type: "getThemePreference", payload: undefined }),
    ]);
    setState({
      lockSettings: lockSettings.status === "fulfilled" ? lockSettings.value : null,
      networkSettings: networkSettings.status === "fulfilled" ? networkSettings.value : null,
      loading: false,
    });
    if (themeSettings.status === "fulfilled") {
      setTheme(themeSettings.value.theme);
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleTheme = async () => {
    const next: ThemePreference = theme === "dark" ? "light" : "dark";
    const previous = theme;
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next === "dark" ? "dark" : "");
    if (next !== "dark") document.documentElement.removeAttribute("data-theme");
    setSavingTheme(true);
    try {
      await runtime.send<ThemeSettings, void>({ type: "setThemePreference", payload: { theme: next } });
    } catch {
      setTheme(previous);
      if (previous === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    } finally {
      setSavingTheme(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Settings" onBack={onBack} />

      <div className="flex flex-1 flex-col gap-8 px-6 pb-6 pt-9">
        <SettingsSection title="Wallet">
          <SettingsRow
            title="Auto-lock"
            subtitle="When the wallet locks itself"
            value={state.loading ? undefined : state.lockSettings ? TIMEOUT_LABELS[state.lockSettings.autoLockTimeout] : "—"}
            onClick={onOpenLockSettings}
          />
          <SettingsRow
            title="Connected apps"
            subtitle="Manage sites with an active grant"
            onClick={onOpenConnectedApps}
          />
        </SettingsSection>

        <SettingsSection title="Network">
          <SettingsRow
            title="Network & peers"
            subtitle="Gateway and AO node endpoints"
            value={
              state.loading ? undefined : state.networkSettings ? gatewayHostname(state.networkSettings.gatewayUrl) : "—"
            }
            onClick={onOpenNetworkPeers}
          />
        </SettingsSection>

        <SettingsSection title="General">
          <ToggleRow
            title="Dark mode"
            checked={theme === "dark"}
            disabled={savingTheme}
            onToggle={() => void handleToggleTheme()}
          />
          <SettingsRow title="Import & export" subtitle="Back up or restore settings" disabled />
          <SettingsRow title="About" disabled />
        </SettingsSection>
      </div>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-line pb-2 text-label font-semibold uppercase tracking-[0.04em] text-muted">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SettingsRow({
  title,
  subtitle,
  value,
  onClick,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 py-3.5 text-left hover:enabled:bg-mist disabled:cursor-default disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-label font-semibold text-foreground">{title}</span>
        {subtitle ? <span className="text-caption text-muted">{subtitle}</span> : null}
      </span>
      {value ? <span className="flex-shrink-0 text-label text-muted">{value}</span> : null}
      {disabled ? null : (
        <span aria-hidden="true" className="flex-shrink-0 text-faint">
          <ChevronIcon />
        </span>
      )}
    </button>
  );
}

function ToggleRow({
  title,
  checked,
  disabled,
  onToggle,
}: {
  title: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center justify-between py-3.5 text-left disabled:opacity-60"
    >
      <span className="text-label font-semibold text-foreground">{title}</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-foreground" : "bg-line"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </span>
    </button>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
