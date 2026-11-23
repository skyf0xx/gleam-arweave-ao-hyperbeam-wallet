import { useState } from "react";
import type { AddTokenApprovalPreview } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { MemorableAddress } from "@gleam/ui/src/components/wallet/index.ts";
import { useAddressIdentity } from "../address-identity";
import { useT } from "../i18n";
import { errorText } from "../i18n/errors";
import { RequestHeader } from "../transfer-review/RequestHeader";
import { ArmingLabel } from "./ArmingLabel";
import { UntrustedText } from "./UntrustedText";

/**
 * A dApp's `addToken` request. Adding only lists the token, so this stays
 * at Consequential tier: no risk notice, primary button. The ticker and
 * name come from the process's own spawn tags, which anyone can set, so the
 * full process id is always shown and the copy says who chose the name.
 */
export interface AddTokenScreenProps {
  origin: string;
  /** The site's icon from its grant, if any. */
  siteIcon?: string | null;
  preview: AddTokenApprovalPreview;
  onReject: () => void;
  /** Rejects, with its message shown inline, if the token can't be added. */
  onAdd: () => Promise<void>;
}

export function AddTokenScreen({ origin, siteIcon, preview, onReject, onAdd }: AddTokenScreenProps) {
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const identity = useAddressIdentity();

  const handleAdd = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onAdd();
    } catch (addError) {
      setError(errorText(addError));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <RequestHeader origin={origin} icon={siteIcon} requestType={t("approval.addToken")} />

      <div className="flex flex-1 flex-col gap-5 px-6 pb-6 pt-6 phone:px-5">
        <div className="flex flex-col items-center gap-1 py-1 text-center">
          <span className="text-display-sm font-semibold dark:font-medium tracking-[-0.02em] text-foreground">
            {preview.ticker !== null ? <UntrustedText text={preview.ticker} /> : t("approval.unknownToken")}
          </span>
          {preview.name !== null ? (
            <span className="text-label text-muted">
              <UntrustedText text={preview.name} />
            </span>
          ) : null}
        </div>

        {/* In silica, one lens holds both addresses and what adding the token means. */}
        <div className="gleam-lens-down flex flex-col gap-5 silica:-mx-6 silica:px-6 silica:pb-6 silica:pt-4 phone:silica:-mx-5 phone:silica:px-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t("approval.processId")}</span>
            <MemorableAddress
              address={preview.processId}
              emphasisPick={identity.emphasisPick}
              avatarSvg={identity.avatarSvg(preview.processId)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t("approval.toWallet")}</span>
            <MemorableAddress
              address={preview.address}
              emphasisPick={identity.emphasisPick}
              avatarSvg={identity.avatarSvg(preview.address)}
            />
          </div>

          <p className="text-caption leading-snug text-muted">
            {t("approval.tokenNotice")}
          </p>
        </div>

        {error ? (
          <div role="alert" className="text-caption leading-snug text-warning">
            {error}
          </div>
        ) : null}

        <div className="mt-auto flex gap-2.5 pt-1">
          <Button type="button" variant="secondary" onClick={onReject} className="flex-1">
            {t("approval.reject")}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitting}
            aria-busy={submitting}
            onClick={() => void handleAdd()}
            className="flex-1"
          >
            {submitting ? t("approval.adding") : <ArmingLabel>{t("approval.addToken")}</ArmingLabel>}
          </Button>
        </div>
      </div>
    </div>
  );
}
