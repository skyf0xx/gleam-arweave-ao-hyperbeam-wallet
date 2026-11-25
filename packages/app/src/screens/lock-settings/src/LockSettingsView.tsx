import { useCallback, useEffect, useState } from "react";
import type {
  BackupProvider,
  AutoLockTimeout,
  PasskeyStatus,
  RuntimePort,
} from "@gleam/core";
import { PasskeyIcon } from "../../unlock/src/UnlockScreen";
import { forgetPasskey, passkeysAvailable } from "../../../passkey/webauthn";
import {
  NetworkErrorBanner,
  SkeletonRow,
} from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { IconRow, SettingsSectionTitle } from "@gleam/ui/src/primitives/setting-rows.tsx";
import { useLockNow, useLockSettings, useSetAutoLockTimeout } from "./useLockSettings";
import { SecurityPhraseSection } from "./SecurityPhraseSection";
import { BiometricSection } from "./BiometricSection";
import { BackupSection } from "./BackupSection";
import type { BiometricUnlockPort } from "../../../app-platform/types";
import { useT, type MessageKey } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { ChoiceRow } from "@gleam/ui/src/primitives/option-list.tsx";

const TIMEOUT_OPTIONS = [
  { value: "never", key: "lockSettings.timeoutNever" },
  { value: "immediate", key: "lockSettings.timeoutImmediate" },
  { value: "5min", key: "lockSettings.timeout5min" },
  { value: "1hr", key: "lockSettings.timeout1hr" },
  { value: "4hr", key: "lockSettings.timeout4hr" },
] as const satisfies ReadonlyArray<{ value: AutoLockTimeout; key: MessageKey }>;

/**
 * Lock & auto-lock settings — "Lock now" triggers `lockWallet()`
 * immediately regardless of timeout, and the auto-lock section is a
 * radio-style option list writing `setLockSettings`, pre-populated from
 * `getLockSettings`.
 */
export interface LockSettingsViewProps {
  runtime: RuntimePort;
  onBack: () => void;
  onLocked: () => void;
  /** Opens the passkey window in setup mode. Omitted, the passkey section is hidden. */
  onSetUpPasskey?: () => Promise<void>;
  /** Injected for tests; defaults to feature-detecting WebAuthn. */
  passkeysSupported?: boolean;
  /** Omitted, the biometric section is hidden. */
  biometrics?: BiometricUnlockPort;
  /** Whether the shell locks the wallet when the OS locks. Off, the copy stops promising it. */
  lockOnSystemLock?: boolean;
  /** Where the shell keeps a vault backup, and how to open its screen. Omitted, the backup section is hidden. */
  backup?: { provider: BackupProvider; open: () => void };
}

export function LockSettingsView({
  runtime,
  onBack,
  onLocked,
  onSetUpPasskey,
  passkeysSupported = passkeysAvailable(),
  biometrics,
  lockOnSystemLock = true,
  backup,
}: LockSettingsViewProps) {
  const t = useT();
  const settingsQuery = useLockSettings(runtime);
  const settings = settingsQuery.data ?? null;
  const lockNow = useLockNow(runtime);
  const setTimeoutMutation = useSetAutoLockTimeout(runtime);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? (settingsQuery.isError ? errorText(settingsQuery.error) : null);
  const locking = lockNow.isPending || lockNow.isSuccess;
  const savingTimeout = setTimeoutMutation.isPending ? setTimeoutMutation.variables : null;

  const handleLockNow = () => {
    lockNow.mutate(undefined, {
      onSuccess: onLocked,
      onError: (caught) => setActionError(errorText(caught)),
    });
  };

  const handleSelectTimeout = (autoLockTimeout: AutoLockTimeout) => {
    if (settings?.autoLockTimeout === autoLockTimeout) return;
    setTimeoutMutation.mutate(autoLockTimeout, { onError: (caught) => setActionError(errorText(caught)) });
  };

  const retry = () => {
    setActionError(null);
    void settingsQuery.refetch();
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("lockSettings.title")} onBack={onBack} />
      {error ? <NetworkErrorBanner onRetry={retry} retrying={settingsQuery.isFetching} /> : null}

      <div className="flex flex-1 flex-col px-6 phone:px-5 pb-6 pt-9 phone:pt-4">
        <div className="pb-10 phone:pb-8">
          <IconRow
            icon={<LockIcon />}
            title={locking ? t("lockSettings.locking") : t("lockSettings.lockNow")}
            description={t("lockSettings.lockNowHint")}
            disabled={locking}
            onClick={() => handleLockNow()}
          />
        </div>

        {biometrics ? <BiometricSection runtime={runtime} biometrics={biometrics} /> : null}

        {onSetUpPasskey ? (
          <PasskeySection
            runtime={runtime}
            supported={passkeysSupported}
            onSetUp={onSetUpPasskey}
          />
        ) : null}

        {backup ? <BackupSection runtime={runtime} provider={backup.provider} onOpen={backup.open} /> : null}

        <SecurityPhraseSection runtime={runtime} />

        <div>
          <SettingsSectionTitle>
            {t("lockSettings.autoLock")}
          </SettingsSectionTitle>
          <div>
            {settingsQuery.isPending ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              TIMEOUT_OPTIONS.map((option) => {
                const selected =
                  settings?.autoLockTimeout === option.value;
                return (
                  <ChoiceRow
                    key={option.value}
                    radio={false}
                    selected={selected}
                    disabled={savingTimeout !== null}
                    onSelect={() => handleSelectTimeout(option.value)}
                    checkIcon={<CheckIcon />}
                  >
                    <span className="flex-1 text-label font-semibold text-foreground">
                      {t(option.key)}
                    </span>
                  </ChoiceRow>
                );
              })
            )}
          </div>
          {settings?.autoLockTimeout === "never" ? (
            <p
              role="note"
              className="pt-2.5 text-caption leading-relaxed text-warning"
            >
              {lockOnSystemLock ? t("lockSettings.neverWithSystemLock") : t("lockSettings.never")}
            </p>
          ) : (
            <p className="pt-2.5 text-caption leading-relaxed text-faint">
              {lockOnSystemLock
                ? t("lockSettings.afterWithSystemLock")
                : t("lockSettings.after")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type PasskeyState =
  | { kind: "loading" }
  | { kind: "ready"; status: PasskeyStatus; busy: boolean; error?: string };

/**
 * The passkey is set up in its own window, so this section re-reads its
 * status whenever this view regains focus, as the side panel does once
 * that window closes.
 */
function PasskeySection({
  runtime,
  supported,
  onSetUp,
}: {
  runtime: RuntimePort;
  supported: boolean;
  onSetUp: () => Promise<void>;
}) {
  const t = useT();
  const [passkey, setPasskey] = useState<PasskeyState>({ kind: "loading" });

  const loadStatus = useCallback(async () => {
    try {
      const status = await runtime.send<void, PasskeyStatus>({
        type: "getPasskeyStatus",
        payload: undefined,
      });
      setPasskey({
        kind: "ready",
        status: status?.enrolled === true ? status : { enrolled: false },
        busy: false,
      });
    } catch (error) {
      setPasskey({
        kind: "ready",
        status: { enrolled: false },
        busy: false,
        error: errorText(error),
      });
    }
  }, [runtime]);

  useEffect(() => {
    void loadStatus();
    const onFocus = () => void loadStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadStatus]);

  const handleSetUp = async () => {
    if (passkey.kind !== "ready") return;
    setPasskey({ ...passkey, busy: true, error: undefined });
    try {
      await onSetUp();
    } catch (error) {
      setPasskey({
        ...passkey,
        busy: false,
        error: errorText(error),
      });
      return;
    }
    setPasskey({ ...passkey, busy: false });
  };

  const handleRemove = async () => {
    if (passkey.kind !== "ready" || !passkey.status.enrolled) return;
    const { credentialId } = passkey.status;
    setPasskey({ ...passkey, busy: true, error: undefined });
    try {
      await runtime.send<void, void>({
        type: "removePasskey",
        payload: undefined,
      });
      forgetPasskey(credentialId);
      setPasskey({ kind: "ready", status: { enrolled: false }, busy: false });
    } catch (error) {
      setPasskey({
        ...passkey,
        busy: false,
        error: errorText(error),
      });
    }
  };

  return (
    <div className="pb-10 phone:pb-8">
      <SettingsSectionTitle>
        {t("lockSettings.passkey")}
      </SettingsSectionTitle>
      {passkey.kind === "loading" ? (
        <SkeletonRow />
      ) : passkey.status.enrolled ? (
        <IconRow
          icon={<PasskeyIcon />}
          title={t("lockSettings.passkeyOn")}
          trailing={
            <button
              type="button"
              disabled={passkey.busy}
              onClick={() => void handleRemove()}
              className="rounded-md px-2 py-1 text-label font-medium text-muted hover:bg-hover hover:text-foreground disabled:opacity-60"
            >
              {passkey.busy ? t("lockSettings.removing") : t("lockSettings.remove")}
            </button>
          }
        />
      ) : supported ? (
        <IconRow
          icon={<PasskeyIcon />}
          title={t("lockSettings.passkeySetUp")}
          description={t("lockSettings.passkeySetUpHint")}
          disabled={passkey.busy}
          onClick={() => void handleSetUp()}
        />
      ) : (
        <p className="py-3.5 text-caption text-muted">
          {t("lockSettings.passkeyUnavailable")}
        </p>
      )}
      {passkey.kind === "ready" && passkey.error ? (
        <InlineError className="pt-1">
          {passkey.error}
        </InlineError>
      ) : null}
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8 11V7a4 4 0 0 1 8 0v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
