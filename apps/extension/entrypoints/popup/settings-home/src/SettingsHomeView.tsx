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
 * its current value on the right, with a Help & About section (feedback
 * card and source link) pinned below them.
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

        <div className="mt-auto">
          <OptionSection title="Help & About">
            <div className="flex flex-col gap-3 pt-3">
              <FeedbackCard onClick={onOpenFeedback} />
              <SourceLink />
            </div>
          </OptionSection>
        </div>
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
      className="flex w-full items-center gap-3 rounded-xl bg-mist px-4 py-4 text-left transition-colors hover:bg-line"
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

const SOURCE_URL = "https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet";

/** A wallet asks for trust, so the source sits one click away. */
function SourceLink() {
  return (
    <a
      href={SOURCE_URL}
      target="_blank"
      rel="noreferrer"
      className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-mist"
    >
      <span aria-hidden="true" className="shrink-0 text-foreground">
        <GitHubIcon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-label font-semibold text-foreground">Gleam is open source</span>
        <span className="text-caption text-muted">MIT licensed. Read the code on GitHub</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-muted">
        <ExternalIcon />
      </span>
    </a>
  );
}

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
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
