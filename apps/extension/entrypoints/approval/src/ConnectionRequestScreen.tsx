import type { ConnectApprovalPreview, PermissionType } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

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
  const { requestedPermissions } = preview;
  const hasUnlimitedSpend = requestedPermissions.some(
    (permission) => permission === "SIGN_TRANSACTION" || permission === "DISPATCH",
  );
  const appName = hostnameOf(origin).split(".")[0] ?? origin;
  const displayName = appName.charAt(0).toUpperCase() + appName.slice(1);

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-5 px-5 py-6">
        <div className="flex flex-col items-center gap-2.5 pb-1 pt-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-[#e5e5e5] bg-[#f5f5f5] text-lg font-bold text-[#737373]">
            {faviconLetter(origin)}
          </div>
          <div className="text-base font-bold text-[#111111]">{displayName}</div>
          <div className="flex items-center gap-1.5 font-mono text-xs text-[#737373]">
            {hostnameOf(origin)}
          </div>
        </div>

        <div className="text-center text-xs font-semibold text-[#737373]">{displayName} wants to:</div>

        <div className="flex flex-col">
          {requestedPermissions.map((permission) => {
            const copy = SCOPE_COPY[permission];
            return (
              <div key={permission} className="flex items-start gap-2.5 border-b border-[#e5e5e5] py-3 last:border-b-0">
                <div
                  className={`mt-px flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[7px] ${
                    copy.risk ? "bg-[#fff5f5] text-[#ff1717]" : "bg-[#f5f5f5] text-[#111111]"
                  }`}
                >
                  <ScopeIcon />
                </div>
                <div className="flex flex-col gap-px">
                  <span className="text-[13px] font-semibold text-[#111111]">{copy.title}</span>
                  <span className="text-[11px] text-[#737373]">{copy.detail}</span>
                </div>
              </div>
            );
          })}
        </div>

        {hasUnlimitedSpend ? (
          <div role="alert" className="flex gap-2.5 rounded-[9px] border border-[#ffd6d6] bg-[#fff5f5] p-3.5">
            <WarningIcon />
            <p className="text-xs leading-relaxed text-[#111111]">
              <strong className="font-bold">This grant has no spending limit.</strong> Most apps don&apos;t
              need this. Only continue if you trust this app completely.
            </p>
          </div>
        ) : null}

        <div className="mt-auto flex gap-2.5">
          <button
            type="button"
            onClick={onReject}
            className="flex-1 rounded-[10px] border border-[#e5e5e5] bg-white py-3 text-sm font-semibold text-[#111111] hover:border-[#a3a3a3]"
          >
            Reject
          </button>
          <Button
            type="button"
            onClick={onGrant}
            className={`flex-1 rounded-[10px] py-3 ${hasUnlimitedSpend ? "bg-[#ff1717] hover:bg-[#ff1717]" : ""}`}
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

function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-px flex-shrink-0 text-[#ff1717]">
      <path
        d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
