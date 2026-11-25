import { hostnameOf } from "../../../hostname";
import { usePlatform } from "../../../app-platform/context";
import type { AutoLockTimeout, RuntimePort, ThemePreference } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { OptionRow } from "@gleam/ui/src/primitives/option-list.tsx";
import { SegmentedRow } from "@gleam/ui/src/primitives/setting-rows.tsx";
import { useDisplaySettings } from "../../../display-settings";
import { useLockSettings } from "../../lock-settings/src/useLockSettings";
import { useNetworkSettings } from "../../main-screen/src/useNetworkSettings";
import { useConnectedApps } from "../../connected-apps/src/useConnectedApps";
import { AboutBuild } from "./AboutBuild";
import { useTheme } from "./useTheme";
import { LANGUAGES, useLanguage, useT, type MessageKey } from "../../../i18n";

const TIMEOUT_KEYS = {
  never: "settingsHome.timeoutNever",
  immediate: "settingsHome.timeoutImmediate",
  "5min": "settingsHome.timeout5min",
  "1hr": "settingsHome.timeout1hr",
  "4hr": "settingsHome.timeout4hr",
} as const satisfies Record<AutoLockTimeout, MessageKey>;

/**
 * The settings screen the gear icon opens: the wallet's own settings, then
 * what connects to it, then the build. Lock now sits in Security. Token and
 * contact lists live where they're used: the token list and Send.
 */
export interface SettingsHomeViewProps {
  runtime: RuntimePort;
  onBack: () => void;
  /** Omitted when the vault has no password, which hides Security. */
  onOpenLockSettings?: () => void;
  onOpenConnectedApps: () => void;
  onOpenAppearance: () => void;
  onOpenNetworkPeers: () => void;
  onOpenFeedback: () => void;
}

export function SettingsHomeView({
  runtime,
  onBack,
  onOpenLockSettings,
  onOpenConnectedApps,
  onOpenAppearance,
  onOpenNetworkPeers,
  onOpenFeedback,
}: SettingsHomeViewProps) {
  const platform = usePlatform();
  const t = useT();
  const language = useLanguage();
  const { version } = platform.buildInfo;
  const lockQuery = useLockSettings(runtime);
  const networkQuery = useNetworkSettings(runtime);
  const appsQuery = useConnectedApps(runtime);
  const loading = lockQuery.isPending || networkQuery.isPending || appsQuery.isPending;
  const lockSettings = lockQuery.data ?? null;
  const networkSettings = networkQuery.data ?? null;
  const connectedApps = appsQuery.data?.length ?? null;
  const theme = useTheme(runtime);
  const { settings: display } = useDisplaySettings(runtime);

  const languageName = LANGUAGES.find((entry) => entry.code === language)?.name;

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader
        title={t("settingsHome.title")}
        onBack={onBack}
        center={
          platform.sidePanel ? (
            // The toggle hangs off the title's right so the title stays centred
            // and the toggle sits clear of where the main screen's gear was clicked.
            <span className="relative text-body font-semibold text-foreground">
              {t("settingsHome.title")}
              <SidePanelToggle
                docked={platform.sidePanel.docked}
                label={t(platform.sidePanel.docked ? "settingsHome.openAsPopup" : "settingsHome.openInSidePanel")}
                onToggle={platform.sidePanel.toggle}
              />
            </span>
          ) : undefined
        }
      />

      <div className="flex flex-1 flex-col gap-6 px-6 pb-4 pt-4 phone:px-5">
        <div className="flex flex-col">
          <SegmentedRow<ThemePreference>
            title={t("settingsHome.theme")}
            value={theme.theme}
            options={[
              { value: "light", label: t("settingsHome.themeLight") },
              { value: "dark", label: t("settingsHome.themeDark") },
              { value: "silica", label: t("settingsHome.themeSilica") },
            ]}
            disabled={theme.saving}
            onChange={(next) => void theme.select(next)}
          />
          {onOpenLockSettings ? (
            <OptionRow
              title={t("settingsHome.security")}
              value={loading ? undefined : lockSettings ? t(TIMEOUT_KEYS[lockSettings.autoLockTimeout]) : "—"}
              onClick={onOpenLockSettings}
            />
          ) : null}
          <OptionRow
            title={t("settingsHome.appearance")}
            value={display ? [display.currency, languageName].filter(Boolean).join(" · ") : undefined}
            onClick={onOpenAppearance}
          />
          <OptionRow
            title={t("settingsHome.networkTitle")}
            value={loading ? undefined : networkSettings ? hostnameOf(networkSettings.gatewayUrl) : "—"}
            onClick={onOpenNetworkPeers}
          />
        </div>

        <div className="flex flex-col">
          <OptionRow
            title={t("settingsHome.connectedApps")}
            count={connectedApps ?? undefined}
            onClick={onOpenConnectedApps}
          />
          <OptionRow external title={t("settingsHome.sendFeedback")} onClick={onOpenFeedback} />
        </div>

        <AboutBuild runtime={runtime} version={version} />
      </div>
    </div>
  );
}

function SidePanelToggle({ docked, label, onToggle }: { docked: boolean; label: string; onToggle: () => Promise<void> }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => void onToggle().catch(() => {})}
      className="absolute left-full top-1/2 ml-0.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M15 4v16" stroke="currentColor" strokeWidth="2" />
        {docked ? <path d="M15 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3z" fill="currentColor" /> : null}
      </svg>
    </button>
  );
}
