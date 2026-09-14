import { useCallback, useEffect, useState } from "react";
import type { Grant, RuntimePort } from "@gleam/core";
import { NetworkErrorBanner, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { EmptyState } from "@gleam/ui/src/primitives/empty-state.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";

/**
 * Ports `connected-apps.html` (6.3) exactly: per-origin grant list with
 * scope + expiry inline (never hidden behind a detail tap), a
 * "Revoke" action per row (brand vocabulary rule: never "disconnect" —
 * this actually ends access, calling `ProtocolMap.revokeGrant`, not just
 * hiding the row), and the populated/empty states from the mockup.
 *
 * Not yet wired into `App.tsx`'s view-switch (`App.tsx` is `wallet-core`'s
 * locked scope, not this task's — see this task's final report, the same
 * "no layer owns App.tsx wiring" gap class the Correction Protocol log
 * already tracks for `send`/`receive`/`activity`) — this view module is
 * complete and independently mountable, following the exact shape
 * `OnboardingView`/`SendView`/`UploadView` already established for this
 * same reason.
 *
 * This is the last remaining consumer of `ScreenHeader` from the
 * `components/onboarding` barrel's backward-compat re-export — repointed
 * here directly at the primitive, closing out that migration debt (see
 * this task's final report for the barrel-file deletion itself, which is
 * outside this task's ALLOWED SCOPE).
 *
 * settings-screens-gap: the ad hoc "Loading…" text and inline error line
 * this screen had are replaced by the shared `SkeletonRow`/
 * `NetworkErrorBanner` (already used by main-screen/activity), per
 * RELEVANT RULES — no new or parallel loading/error primitive.
 */
export interface ConnectedAppsViewProps {
  runtime: RuntimePort;
  onBack: () => void;
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function canSpendUnlimited(grant: Grant): boolean {
  return grant.permissions.some((permission) => permission === "SIGN_TRANSACTION" || permission === "DISPATCH");
}

function scopeSummary(grant: Grant): string {
  if (canSpendUnlimited(grant)) return "Sees your address, can spend with no limit";
  if (grant.permissions.length > 1) return "Sees your address and more";
  return "Sees your address only";
}

function expirySummary(grant: Grant): string {
  if (grant.expiresAt === null) return "No expiry · until revoked";
  const daysLeft = Math.max(0, Math.ceil((grant.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  return `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

export function ConnectedAppsView({ runtime, onBack }: ConnectedAppsViewProps) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const result = await runtime.send<void, Grant[]>({ type: "getConnectedApps", payload: undefined });
      setGrants(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (origin: string) => {
    await runtime.send<{ origin: string }, void>({ type: "revokeGrant", payload: { origin } });
    await load();
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Connected apps" onBack={onBack} />
      {error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}
      <div className="flex flex-1 flex-col px-5 py-4">
        {grants === null ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : grants.length === 0 ? (
          <EmptyState message="No apps connected yet. Grants you approve will show up here." />
        ) : (
          <div className="flex flex-col">
            {grants.map((grant) => (
              <div key={grant.origin} className="flex items-start gap-3 border-b border-line py-3.5 last:border-b-0">
                <div className="mt-px flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-line bg-mist text-label font-bold text-muted">
                  {hostnameOf(grant.origin).charAt(0).toUpperCase()}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-label font-semibold text-foreground">
                      {hostnameOf(grant.origin)}
                    </span>
                    {canSpendUnlimited(grant) ? (
                      <span className="flex-shrink-0 rounded-md border border-warning-border bg-warning-surface px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-warning">
                        NO LIMIT
                      </span>
                    ) : null}
                  </div>
                  <span className="font-mono text-caption text-faint">{hostnameOf(grant.origin)}</span>
                  <span className="text-label leading-snug text-muted">{scopeSummary(grant)}</span>
                  <span className="text-caption text-faint">{expirySummary(grant)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(grant.origin)}
                  className="mt-px flex-shrink-0 rounded-md border border-line bg-background px-3 py-1.5 text-label font-semibold text-foreground hover:border-warning hover:text-warning"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
