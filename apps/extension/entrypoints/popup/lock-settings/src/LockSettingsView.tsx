import { useCallback, useEffect, useState } from "react";
import type { AutoLockTimeout, LockSettings, RuntimePort } from "@gleam/core";
import { NetworkErrorBanner, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";

const TIMEOUT_OPTIONS: Array<{ value: AutoLockTimeout; label: string }> = [
  { value: "never", label: "Never" },
  { value: "immediate", label: "Immediately" },
  { value: "5min", label: "5 minutes" },
  { value: "1hr", label: "1 hour" },
  { value: "4hr", label: "4 hours" },
];

/**
 * Lock & auto-lock settings (lock-settings.html / TODO.md 1.6) — "Lock
 * now" triggers `lockWallet()` immediately regardless of timeout, and the
 * auto-lock section is a radio-style option list writing
 * `setLockSettings`, pre-populated from `getLockSettings`. No new backend
 * (RELEVANT RULES): both RPCs are already implemented and wired.
 */
export interface LockSettingsViewProps {
  runtime: RuntimePort;
  onBack: () => void;
  onLocked: () => void;
}

interface LoadState {
  settings: LockSettings | null;
  loading: boolean;
  error: string | null;
}

export function LockSettingsView({ runtime, onBack, onLocked }: LockSettingsViewProps) {
  const [state, setState] = useState<LoadState>({ settings: null, loading: true, error: null });
  const [locking, setLocking] = useState(false);
  const [savingTimeout, setSavingTimeout] = useState<AutoLockTimeout | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const settings = await runtime.send<void, LockSettings>({ type: "getLockSettings", payload: undefined });
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
      await runtime.send<void, void>({ type: "lockWallet", payload: undefined });
      onLocked();
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
      setLocking(false);
    }
  };

  const handleSelectTimeout = async (autoLockTimeout: AutoLockTimeout) => {
    if (state.settings?.autoLockTimeout === autoLockTimeout) return;
    setSavingTimeout(autoLockTimeout);
    try {
      await runtime.send<LockSettings, void>({ type: "setLockSettings", payload: { autoLockTimeout } });
      setState((prev) => ({ ...prev, settings: { autoLockTimeout } }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSavingTimeout(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Lock & auto-lock" onBack={onBack} />
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <div className="flex flex-1 flex-col px-6 pb-6 pt-9">
        <div className="pb-10">
          <div className="rounded-xl border border-line">
            <button
              type="button"
              disabled={locking}
              onClick={() => void handleLockNow()}
              className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3.5 text-left hover:bg-mist disabled:opacity-60"
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
        </div>

        <div>
          <div className="pb-3.5 text-label font-semibold uppercase tracking-[0.04em] text-muted">Auto-lock</div>
          <div className="rounded-xl border border-line px-3.5">
            {state.loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              TIMEOUT_OPTIONS.map((option) => {
                const selected = state.settings?.autoLockTimeout === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={savingTimeout !== null}
                    onClick={() => void handleSelectTimeout(option.value)}
                    className="flex w-full items-center gap-2.5 border-b border-line py-3.5 text-left last:border-b-0 hover:bg-mist disabled:opacity-60"
                  >
                    <span className="flex-1 text-label font-semibold text-foreground">{option.label}</span>
                    {selected ? (
                      <span aria-hidden="true" className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-foreground">
                        <CheckIcon />
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          <p className="pt-2.5 text-caption leading-relaxed text-faint">
            Gleam stays unlocked until you lock it or this timeout is reached.
          </p>
        </div>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
