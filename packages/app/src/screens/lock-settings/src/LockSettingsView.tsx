import { useCallback, useEffect, useState } from "react";
import type {
  AutoLockTimeout,
  LockSettings,
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
import { SecurityPhraseSection } from "./SecurityPhraseSection";

const TIMEOUT_OPTIONS: Array<{ value: AutoLockTimeout; label: string }> = [
  { value: "never", label: "Never" },
  { value: "immediate", label: "After 1 minute" },
  { value: "5min", label: "5 minutes" },
  { value: "1hr", label: "1 hour" },
  { value: "4hr", label: "4 hours" },
];

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
}

interface LoadState {
  settings: LockSettings | null;
  loading: boolean;
  error: string | null;
}

export function LockSettingsView({
  runtime,
  onBack,
  onLocked,
  onSetUpPasskey,
  passkeysSupported = passkeysAvailable(),
}: LockSettingsViewProps) {
  const [state, setState] = useState<LoadState>({
    settings: null,
    loading: true,
    error: null,
  });
  const [locking, setLocking] = useState(false);
  const [savingTimeout, setSavingTimeout] = useState<AutoLockTimeout | null>(
    null,
  );

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const settings = await runtime.send<void, LockSettings>({
        type: "getLockSettings",
        payload: undefined,
      });
      setState({ settings, loading: false, error: null });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLockNow = async () => {
    setLocking(true);
    try {
      await runtime.send<void, void>({
        type: "lockWallet",
        payload: undefined,
      });
      onLocked();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
      setLocking(false);
    }
  };

  const handleSelectTimeout = async (autoLockTimeout: AutoLockTimeout) => {
    if (state.settings?.autoLockTimeout === autoLockTimeout) return;
    setSavingTimeout(autoLockTimeout);
    try {
      await runtime.send<LockSettings, void>({
        type: "setLockSettings",
        payload: { autoLockTimeout },
      });
      setState((prev) => ({ ...prev, settings: { autoLockTimeout } }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setSavingTimeout(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Lock & unlock" onBack={onBack} />
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <div className="flex flex-1 flex-col px-6 pb-6 pt-9">
        <div className="pb-10">
          <button
            type="button"
            disabled={locking}
            onClick={() => void handleLockNow()}
            className="flex w-full items-center gap-3 py-3.5 text-left hover:bg-mist disabled:opacity-60"
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-mist text-foreground">
              <LockIcon />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-label font-semibold text-foreground">
                {locking ? "Locking…" : "Lock now"}
              </span>
              <span className="text-caption text-muted">
                Immediately clears this session, regardless of timeout
              </span>
            </span>
          </button>
        </div>

        {onSetUpPasskey ? (
          <PasskeySection
            runtime={runtime}
            supported={passkeysSupported}
            onSetUp={onSetUpPasskey}
          />
        ) : null}

        <SecurityPhraseSection runtime={runtime} />

        <div>
          <div className="border-b border-line pb-3.5 text-label font-semibold uppercase tracking-[0.04em] text-muted">
            Auto-lock
          </div>
          <div>
            {state.loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              TIMEOUT_OPTIONS.map((option) => {
                const selected =
                  state.settings?.autoLockTimeout === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={savingTimeout !== null}
                    onClick={() => void handleSelectTimeout(option.value)}
                    className="flex w-full items-center gap-2.5 py-3.5 text-left hover:bg-mist disabled:opacity-60"
                  >
                    <span className="flex-1 text-label font-semibold text-foreground">
                      {option.label}
                    </span>
                    {selected ? (
                      <span
                        aria-hidden="true"
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-foreground"
                      >
                        <CheckIcon />
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          {state.settings?.autoLockTimeout === "never" ? (
            <p
              role="note"
              className="pt-2.5 text-caption leading-relaxed text-warning"
            >
              Gleam stays unlocked always, even when your computer locks.
            </p>
          ) : (
            <p className="pt-2.5 text-caption leading-relaxed text-faint">
              Gleam locks after this long without use, and whenever your
              computer locks.
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

function formatSetUpDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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
        error: error instanceof Error ? error.message : String(error),
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
        error: error instanceof Error ? error.message : String(error),
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
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="pb-10">
      <div className="border-b border-line pb-3.5 text-label font-semibold uppercase tracking-[0.04em] text-muted">
        Passkey
      </div>
      {passkey.kind === "loading" ? (
        <SkeletonRow />
      ) : passkey.status.enrolled ? (
        <div className="flex items-center gap-3 py-3.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-mist text-foreground">
            <PasskeyIcon />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label font-semibold text-foreground">
              Unlock with passkey is on
            </span>
            <span className="text-caption text-muted">
              Set up {formatSetUpDate(passkey.status.createdAt)}
            </span>
          </span>
          <button
            type="button"
            disabled={passkey.busy}
            onClick={() => void handleRemove()}
            className="rounded-md px-2 py-1 text-label font-medium text-muted hover:bg-mist hover:text-foreground disabled:opacity-60"
          >
            {passkey.busy ? "Removing…" : "Remove"}
          </button>
        </div>
      ) : supported ? (
        <button
          type="button"
          disabled={passkey.busy}
          onClick={() => void handleSetUp()}
          className="flex w-full items-center gap-3 py-3.5 text-left hover:bg-mist disabled:opacity-60"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-mist text-foreground">
            <PasskeyIcon />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label font-semibold text-foreground">
              Set up a passkey
            </span>
            <span className="text-caption text-muted">
              Unlock with your fingerprint, face or security key
            </span>
          </span>
        </button>
      ) : (
        <p className="py-3.5 text-caption text-muted">
          Passkeys aren&apos;t available in this browser.
        </p>
      )}
      {passkey.kind === "ready" && passkey.error ? (
        <p role="alert" className="pt-1 text-caption text-warning">
          {passkey.error}
        </p>
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
