import { useState } from "react";
import type { ConnectApprovalPreview, PermissionType } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { useT, type MessageKey } from "../i18n";
import { splitOrigin } from "../transfer-review/RequestHeader";
import { UntrustedText } from "./UntrustedText";

/**
 * Ports `connection-request.html` (6.1): origin identity, "wants to:"
 * scope list in plain nouns (brand vocabulary rule — "grant," never
 * "connection"/"approval," for the scope itself), and a two-button
 * reject/grant action row. Spending scopes carry no risk escalation here:
 * they only let the app *request* a payment, and every payment opens its
 * own signing approval, which is where the Irreversible tier lives.
 */
export interface ConnectionRequestScreenProps {
  origin: string;
  preview: ConnectApprovalPreview;
  onReject: () => void;
  onGrant: () => void;
}

export const SCOPE_COPY: Record<PermissionType, { title: MessageKey; detail: MessageKey }> = {
  ACCESS_ADDRESS: { title: "approval.scopeAddressTitle", detail: "approval.scopeAddressDetail" },
  ACCESS_PUBLIC_KEY: { title: "approval.scopePublicKeyTitle", detail: "approval.scopePublicKeyDetail" },
  ACCESS_ALL_ADDRESSES: { title: "approval.scopeAllAddressesTitle", detail: "approval.scopeAllAddressesDetail" },
  ACCESS_ARWEAVE_CONFIG: { title: "approval.scopeNetworkTitle", detail: "approval.scopeNetworkDetail" },
  ACCESS_TOKENS: { title: "approval.scopeTokensTitle", detail: "approval.scopeTokensDetail" },
  SIGN_TRANSACTION: { title: "approval.scopePaymentsTitle", detail: "approval.scopePaymentsDetail" },
  SIGNATURE: { title: "approval.scopeSignDataTitle", detail: "approval.scopeSignDataDetail" },
  ENCRYPT: { title: "approval.scopeEncryptTitle", detail: "approval.scopeKeyDetail" },
  DECRYPT: { title: "approval.scopeDecryptTitle", detail: "approval.scopeKeyDetail" },
  DISPATCH: { title: "approval.scopePaymentsTitle", detail: "approval.scopePaymentsDetail" },
};

function faviconLetter(origin: string): string {
  try {
    return new URL(origin).hostname.charAt(0).toUpperCase();
  } catch {
    return origin.charAt(0).toUpperCase();
  }
}

/** Stands in for the site's name so the sentence can be translated whole and the name rendered as untrusted text. */
const NAME_SLOT = "\u0000";

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function ConnectionRequestScreen({ origin, preview, onReject, onGrant }: ConnectionRequestScreenProps) {
  const t = useT();
  const { requestedPermissions, appInfo } = preview;
  const fallbackName = hostnameOf(origin).split(".")[0] ?? origin;
  const displayName = appInfo?.name?.trim() || fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1);
  const [logoFailed, setLogoFailed] = useState(false);
  const logoUrl = !logoFailed ? (appInfo?.logo ?? null) : null;
  const [wantsBefore = "", wantsAfter = ""] = t("approval.wantsTo", { name: NAME_SLOT }).split(NAME_SLOT);
  // The full origin, shown whole and wrapping like RequestHeader: the
  // hostname alone under an attacker-supplied appInfo name lets a
  // lookalike host pass for the real site.
  const { scheme, host } = splitOrigin(origin);

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
          <div className="text-body font-bold text-foreground">
            <UntrustedText text={displayName} />
          </div>
          <div className="break-all font-mono text-caption text-muted">
            {scheme ? <span className="font-normal">{scheme}</span> : null}
            <span>{host}</span>
          </div>
        </div>

        <div className="text-center text-caption font-semibold text-muted">
          {wantsBefore}
          <UntrustedText text={displayName} />
          {wantsAfter}
        </div>

        <div className="flex flex-col">
          {requestedPermissions.map((permission) => {
            const copy = SCOPE_COPY[permission];
            return (
              <div key={permission} className="flex items-start gap-2.5 border-b border-line py-3 last:border-b-0">
                <div className="mt-px flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md bg-mist text-foreground">
                  <ScopeIcon />
                </div>
                <div className="flex flex-col gap-px">
                  <span className="text-label font-semibold text-foreground">{t(copy.title)}</span>
                  <span className="text-caption text-muted">{t(copy.detail)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-auto flex gap-2.5">
          <Button type="button" variant="secondary" onClick={onReject} className="flex-1">
            {t("approval.reject")}
          </Button>
          <Button type="button" variant="primary" onClick={onGrant} className="flex-1">
            {t("approval.grant")}
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
