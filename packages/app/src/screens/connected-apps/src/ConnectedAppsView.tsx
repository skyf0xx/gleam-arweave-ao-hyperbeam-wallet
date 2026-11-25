import { useCallback, useEffect, useState } from "react";
import { hostnameOf } from "../../../hostname";
import type { Grant, RuntimePort, WalletSummary } from "@gleam/core";
import { NetworkErrorBanner, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { EmptyState } from "@gleam/ui/src/primitives/empty-state.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { useT, type TFunction } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { SCOPE_COPY } from "../../../approval/ConnectionRequestScreen";
import { SiteIcon } from "../../site-wallet/src/SiteWalletCard";

/**
 * Per-origin grant list with scope + expiry inline. "Revoke" (never
 * "disconnect") actually ends access via `ProtocolMap.revokeGrant`, not
 * just hiding the row, so it asks once before doing it.
 */
export interface ConnectedAppsViewProps {
  runtime: RuntimePort;
  onBack: () => void;
  /** The site the user came from in the browser: its entry is listed first and set apart. */
  highlightOrigin?: string;
  /** Names each grant's wallet when there is more than one to tell apart. */
  wallets?: readonly WalletSummary[];
}

function canRequestPayments(grant: Grant): boolean {
  return grant.permissions.some((permission) => permission === "SIGN_TRANSACTION" || permission === "DISPATCH");
}

function scopeSummary(grant: Grant, t: TFunction): string {
  if (canRequestPayments(grant)) return t("connectedApps.scopePayments");
  if (grant.permissions.length > 1) return t("connectedApps.scopeMore");
  return t("connectedApps.scopeAddress");
}

/** Grants last until revoked unless they say otherwise, so only an expiry is worth a line. */
function expirySummary(grant: Grant, t: TFunction): string | null {
  if (grant.expiresAt === null) return null;
  const daysLeft = Math.max(0, Math.ceil((grant.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  return t(daysLeft === 1 ? "connectedApps.expiresOneDay" : "connectedApps.expiresDays", { days: daysLeft });
}

/** Several permissions share one plain-language title, as payments do. */
function permissionTitles(grant: Grant, t: TFunction): string[] {
  return [...new Set(grant.permissions.map((permission) => t(SCOPE_COPY[permission].title)))];
}

/** The site the user came from first, then the most recently granted. */
function orderGrants(grants: readonly Grant[], highlightOrigin: string | undefined): Grant[] {
  return [...grants].sort(
    (a, b) =>
      Number(b.origin === highlightOrigin) - Number(a.origin === highlightOrigin) || b.createdAt - a.createdAt,
  );
}

export function ConnectedAppsView({ runtime, onBack, highlightOrigin, wallets = [] }: ConnectedAppsViewProps) {
  const t = useT();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const result = await runtime.send<void, Grant[]>({ type: "getConnectedApps", payload: undefined });
      setGrants(result);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const walletNameOf = (walletId: string): string | null =>
    wallets.length > 1 ? (wallets.find((wallet) => wallet.id === walletId)?.name ?? null) : null;

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("connectedApps.title")} onBack={onBack} />
      {error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}
      <div className="flex flex-1 flex-col px-5 py-4">
        {grants === null ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : grants.length === 0 ? (
          <EmptyState message={t("connectedApps.empty")} />
        ) : (
          <div className="flex flex-col gap-1">
            {orderGrants(grants, highlightOrigin).map((grant) => (
              <GrantRow
                key={grant.origin}
                grant={grant}
                highlighted={grant.origin === highlightOrigin}
                walletName={walletNameOf(grant.walletId)}
                onRevoke={async () => {
                  await runtime.send<{ origin: string }, void>({ type: "revokeGrant", payload: { origin: grant.origin } });
                  await load();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GrantRow({
  grant,
  highlighted,
  walletName,
  onRevoke,
}: {
  grant: Grant;
  highlighted: boolean;
  walletName: string | null;
  onRevoke: () => Promise<void>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [failed, setFailed] = useState(false);
  const hostname = hostnameOf(grant.origin);
  const name = grant.name ?? null;
  const caption = [walletName ? t("connectedApps.connectedTo", { wallet: walletName }) : null, expirySummary(grant, t)]
    .filter(Boolean)
    .join(" · ");

  const revoke = async () => {
    setRevoking(true);
    setFailed(false);
    try {
      await onRevoke();
    } catch {
      setFailed(true);
      setRevoking(false);
    }
  };

  return (
    <div className={`flex flex-col gap-2.5 py-2.5 ${highlighted ? "-mx-3 rounded-xl bg-mist px-3" : ""}`}>
      <div className="flex items-start gap-3">
        <SiteIcon origin={grant.origin} favIconUrl={grant.icon ?? null} size="md" className="mt-px" />
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={t("connectedApps.showPermissions", { site: hostname })}
          onClick={() => setExpanded((open) => !open)}
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
        >
          <span className="truncate text-label font-semibold text-foreground">{name ?? hostname}</span>
          {name ? <span className="truncate font-mono text-caption text-faint">{hostname}</span> : null}
          <span className="text-label leading-snug text-muted">{scopeSummary(grant, t)}</span>
          {caption ? <span className="text-caption text-faint">{caption}</span> : null}
        </button>
        {confirming ? null : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-px flex-shrink-0 rounded-md px-2 py-1.5 text-label font-semibold text-muted hover:bg-hover hover:text-warning"
          >
            {t("connectedApps.revoke")}
          </button>
        )}
      </div>
      {expanded ? (
        <ul className="ml-12 flex flex-col gap-2 rounded-lg bg-mist px-3 py-2.5 text-caption text-foreground">
          {permissionTitles(grant, t).map((title) => (
            <li key={title} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="h-1 w-1 flex-shrink-0 rounded-full bg-faint" />
              {title}
            </li>
          ))}
        </ul>
      ) : null}
      {confirming ? (
        <div className="ml-12 flex items-center gap-2">
          <span className="flex-1 text-caption text-muted">{t("connectedApps.revokePrompt")}</span>
          <button
            type="button"
            disabled={revoking}
            onClick={() => {
              setConfirming(false);
              setFailed(false);
            }}
            className="rounded-md px-2 py-1.5 text-label font-semibold text-muted hover:bg-hover disabled:opacity-50"
          >
            {t("connectedApps.cancel")}
          </button>
          <button
            type="button"
            disabled={revoking}
            onClick={() => void revoke()}
            className="rounded-md px-2 py-1.5 text-label font-semibold text-warning hover:bg-hover disabled:opacity-50"
          >
            {t("connectedApps.revoke")}
          </button>
        </div>
      ) : null}
      {failed ? (
        <InlineError as="span" className="ml-12">
          {t("connectedApps.revokeFailed")}
        </InlineError>
      ) : null}
    </div>
  );
}

