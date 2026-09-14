import { useCallback, useEffect, useState } from "react";
import type { Grant, RuntimePort } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/components/onboarding/index.ts";

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

function scopeSummary(grant: Grant): string {
  const canSpendUnlimited = grant.permissions.some(
    (permission) => permission === "SIGN_TRANSACTION" || permission === "DISPATCH",
  );
  if (canSpendUnlimited) return "Sees your address, can spend with no limit";
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
    try {
      const result = await runtime.send<void, Grant[]>({ type: "getConnectedApps", payload: undefined });
      setGrants(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setGrants([]);
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
      <div className="flex flex-1 flex-col px-5 py-4">
        {error ? (
          <div role="alert" className="mb-3 text-xs leading-snug text-[#ff1717]">
            {error}
          </div>
        ) : null}

        {grants === null ? (
          <div className="p-4 text-sm text-[#737373]">Loading…</div>
        ) : grants.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 py-12 text-center">
            <div role="presentation" className="h-[3px] w-8 rounded-sm bg-[#e5e5e5]" />
            <p className="max-w-[260px] text-[13px] text-[#737373]">
              No apps connected yet. Grants you approve will show up here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {grants.map((grant) => (
              <div key={grant.origin} className="flex items-start gap-3 border-b border-[#e5e5e5] py-3.5 last:border-b-0">
                <div className="mt-px flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#e5e5e5] bg-[#f5f5f5] text-xs font-bold text-[#737373]">
                  {hostnameOf(grant.origin).charAt(0).toUpperCase()}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-semibold text-[#111111]">{hostnameOf(grant.origin)}</span>
                  <span className="font-mono text-[11px] text-[#a3a3a3]">{hostnameOf(grant.origin)}</span>
                  <span className="text-xs leading-snug text-[#737373]">{scopeSummary(grant)}</span>
                  <span className="text-[11px] text-[#a3a3a3]">{expirySummary(grant)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(grant.origin)}
                  className="mt-px flex-shrink-0 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-semibold text-[#111111] hover:border-[#ff1717] hover:text-[#ff1717]"
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
