import { useState } from "react";
import type { ConnectApprovalPreview, PermissionType } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";

/**
 * Ports `connection-request.html` (6.1) exactly: origin identity, "wants
 * to:" scope list in plain nouns (brand vocabulary rule — "grant," never
 * "connection"/"approval," for the scope itself), an Irreversible-tier
 * red escalation when a requested scope has no spending limit, and a
 * two-button reject/grant action row. This build's Phase 1 `Grant` model
 * has no spending-limit concept yet (`budget` is always `null` — see
 * `core/models/grant.ts`), so the escalation here triggers on
 * `SIGN_TRANSACTION`/`DISPATCH` (the two scopes that let a connected app
 * move funds with no per-grant limit in this phase) rather than on a
 * budget comparison the model can't yet express.
 */
export interface ConnectionRequestScreenProps {
  origin: string;
  preview: ConnectApprovalPreview;
  onReject: () => void;
  onGrant: () => void;
}

const SCOPE_COPY: Record<PermissionType, { title: string; detail: string; risk?: boolean }> = {
  ACCESS_ADDRESS: { title: "See your address", detail: "Your public wallet address" },
  ACCESS_PUBLIC_KEY: { title: "See your public key", detail: "Used to verify signatures" },
  ACCESS_ALL_ADDRESSES: { title: "See all your wallets", detail: "Every address you've added" },
  ACCESS_ARWEAVE_CONFIG: { title: "See your network settings", detail: "Gateway and peer configuration" },
  ACCESS_TOKENS: { title: "See your token balances", detail: "AR and AO token balances" },
  SIGN_TRANSACTION: { title: "Spend with no limit", detail: "Until revoked", risk: true },
  SIGNATURE: { title: "Ask you to sign data", detail: "Reviewed individually, every time" },
  ENCRYPT: { title: "Encrypt data for you", detail: "Using your key" },
  DECRYPT: { title: "Decrypt data for you", detail: "Using your key" },
  DISPATCH: { title: "Spend with no limit", detail: "Until revoked", risk: true },
};

function faviconLetter(origin: string): string {
  try {
    return new URL(origin).hostname.charAt(0).toUpperCase();
  } catch {
    return origin.charAt(0).toUpperCase();
  }
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function ConnectionRequestScreen({ origin, preview, onReject, onGrant }: ConnectionRequestScreenProps) {
  const { requestedPermissions, appInfo } = preview;
  const hasUnlimitedSpend = requestedPermissions.some(
    (permission) => permission === "SIGN_TRANSACTION" || permission === "DISPATCH",
  );
  const fallbackName = hostnameOf(origin).split(".")[0] ?? origin;
  const displayName = appInfo?.name?.trim() || fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1);
  const [logoFailed, setLogoFailed] = useState(false);
  const logoUrl = !logoFailed ? (appInfo?.logo ?? null) : null;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-5 px-5 py-6">
        <div className="flex flex-col items-center gap-2.5 pb-1 pt-2 text-center">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="h-12 w-12 rounded-lg border border-line object-cover"
              // A dApp-supplied URL that fails to load falls back to the
              // origin-derived letter tile rather than a broken image icon.
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-mist text-lg font-bold text-muted">
              {faviconLetter(origin)}
            </div>
          )}
          <div className="text-body font-bold text-foreground">{displayName}</div>
          <div className="flex items-center gap-1.5 font-mono text-caption text-muted">{hostnameOf(origin)}</div>
        </div>

        <div className="text-center text-caption font-semibold text-muted">{displayName} wants to:</div>

        <div className="flex flex-col">
          {requestedPermissions.map((permission) => {
            const copy = SCOPE_COPY[permission];
            return (
              <div key={permission} className="flex items-start gap-2.5 border-b border-line py-3 last:border-b-0">
                <div
                  className={`mt-px flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md ${
                    copy.risk ? "bg-warning-surface text-warning" : "bg-mist text-foreground"
                  }`}
                >
                  <ScopeIcon />
                </div>
                <div className="flex flex-col gap-px">
                  <span className="text-label font-semibold text-foreground">{copy.title}</span>
                  <span className="text-caption text-muted">{copy.detail}</span>
                </div>
              </div>
            );
          })}
        </div>

        {hasUnlimitedSpend ? (
          <RiskNotice>
            <strong className="font-bold">This grant has no spending limit.</strong> Most apps don&apos;t need
            this. Only continue if you trust this app completely.
          </RiskNotice>
        ) : null}

        <div className="mt-auto flex gap-2.5">
          <Button type="button" variant="secondary" onClick={onReject} className="flex-1">
            Reject
          </Button>
          <Button
            type="button"
            variant={hasUnlimitedSpend ? "destructive" : "primary"}
            onClick={onGrant}
            className="flex-1"
          >
            Grant
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScopeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
