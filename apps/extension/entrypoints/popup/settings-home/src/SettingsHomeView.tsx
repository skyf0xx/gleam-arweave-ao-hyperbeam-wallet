import { useCallback, useEffect, useState } from "react";
import type { AutoLockTimeout, LockSettings, NetworkSettings, RuntimePort, ThemePreference, ThemeSettings } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { OptionRow, OptionSection } from "@gleam/ui/src/primitives/option-list.tsx";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";

const TIMEOUT_LABELS: Record<AutoLockTimeout, string> = {
  never: "Never",
  immediate: "After 1 minute",
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
 * The dedicated settings screen the gear icon opens: grouped
 * WALLET/NETWORK/TOOLS/GENERAL sections of navigable rows, each showing
 * its current value on the right, with a feedback card pinned below them.
 * "Upload to Arweave" is disabled, with a "Coming soon" label, until
 * bundler uploads work reliably.
 */
export interface SettingsHomeViewProps {
  runtime: RuntimePort;
  onBack: () => void;
  /** Omitted when the vault has no password, which hides the lock row. */
  onOpenLockSettings?: () => void;
  onOpenConnectedApps: () => void;
  onOpenNetworkPeers: () => void;
  onOpenManageTokens: () => void;
  onOpenContacts: () => void;
  onOpenUpload: () => void;
  onOpenFeedback: () => void;
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
  onOpenManageTokens,
  onOpenContacts,
  onOpenUpload,
  onOpenFeedback,
}: SettingsHomeViewProps) {
  // Upload row is disabled below; onOpenUpload stays in the prop contract
  // so re-enabling it is a one-line change.
  void onOpenUpload;
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
        <OptionSection title="Wallet">
          {onOpenLockSettings ? (
            <OptionRow
              divided={false}
              title="Lock & unlock"
              description="Auto-lock and passkey"
              value={state.loading ? undefined : state.lockSettings ? TIMEOUT_LABELS[state.lockSettings.autoLockTimeout] : "—"}
              onClick={onOpenLockSettings}
            />
          ) : null}
          <OptionRow
            divided={false}
            title="Connected apps"
            description="Manage sites with an active grant"
            onClick={onOpenConnectedApps}
          />
          <OptionRow
            divided={false}
            title="Manage tokens"
            description="Add or remove watched AO tokens"
            onClick={onOpenManageTokens}
          />
          <OptionRow
            divided={false}
            title="Contacts"
            description="Saved addresses for sending"
            onClick={onOpenContacts}
          />
        </OptionSection>

        <OptionSection title="Network">
          <OptionRow
            divided={false}
            title="Network & peers"
            description="Gateway and AO node endpoints"
            value={
              state.loading ? undefined : state.networkSettings ? gatewayHostname(state.networkSettings.gatewayUrl) : "—"
            }
            onClick={onOpenNetworkPeers}
          />
        </OptionSection>

        <OptionSection title="Tools">
          {/* Bundler uploads don't yet work reliably with current AO wallets;
              re-enable by restoring onClick={onOpenUpload} below. */}
          <OptionRow divided={false} title="Upload to Arweave" description="Store a file permanently" disabled comingSoon />
        </OptionSection>

        <OptionSection title="General">
          <ToggleRow
            title="Dark mode"
            checked={theme === "dark"}
            disabled={savingTheme}
            onToggle={() => void handleToggleTheme()}
          />
        </OptionSection>

        <FeedbackCard onClick={onOpenFeedback} />
      </div>
    </div>
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

/**
 * Sits apart from the setting rows: it leaves the wallet for the website's
 * feedback form, so it reads as an invitation rather than another setting.
 */
function FeedbackCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-auto flex w-full items-center gap-3 rounded-xl bg-mist px-4 py-4 text-left transition-colors hover:bg-line"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <Beam className="w-8" />
        <span className="text-label font-semibold text-foreground">Got an issue or suggestion?</span>
        <span className="text-caption text-muted">Send us a message</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-muted">
        <ExternalIcon />
      </span>
    </button>
  );
}

function ExternalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
