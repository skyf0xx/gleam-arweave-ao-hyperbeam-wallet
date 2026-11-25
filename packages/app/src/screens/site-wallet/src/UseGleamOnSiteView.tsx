import { useState } from "react";
import type { PermissionType, RuntimePort } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { SiteIcon } from "./SiteWalletCard";
import { PERMISSION_GROUPS, initialGroupIds, permissionsFor } from "./site-card";
import { hostnameOf } from "../../../hostname";
import { useUseGleamOnSite } from "./useActiveSite";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";

export interface UseGleamOnSiteViewProps {
  runtime: RuntimePort;
  origin: string;
  favIconUrl: string | null;
  /** What the site asked the other wallet for. Those groups start on in place of the defaults. */
  requestedPermissions?: readonly PermissionType[];
  onBack: () => void;
  onDone: () => void;
}

/**
 * The popup's own connect screen for a site that was using another wallet.
 * The user is already looking at Gleam, so this grants directly instead of
 * opening an approval window. Signing requests still open one each.
 */
export function UseGleamOnSiteView({
  runtime,
  origin,
  favIconUrl,
  requestedPermissions = [],
  onBack,
  onDone,
}: UseGleamOnSiteViewProps) {
  const t = useT();
  const host = hostnameOf(origin);
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(() => initialGroupIds(requestedPermissions));
  const useGleam = useUseGleamOnSite(runtime);

  const toggle = (id: string) =>
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () => useGleam.mutate({ origin, permissions: permissionsFor(enabled) }, { onSuccess: onDone });

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("siteWallet.useGleamHere")} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-5 px-5 py-5 phone:pb-0">
        <div className="flex flex-col items-center gap-2 text-center">
          <SiteIcon origin={origin} favIconUrl={favIconUrl} size="lg" />
          <div className="font-mono text-label text-foreground">{host}</div>
        </div>

        <section aria-label={t("siteWallet.permissions")} className="flex flex-col">
          <div className="border-b border-line pb-2 text-label font-semibold text-muted phone:border-b-0">{t("siteWallet.siteCan")}</div>
          {PERMISSION_GROUPS.map((group) => {
            const on = group.required === true || enabled.has(group.id);
            return (
              <div key={group.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0 phone:border-b-0">
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-label font-semibold text-foreground">{t(group.titleKey)}</span>
                  <span className="text-caption text-muted">{t(group.detailKey)}</span>
                </div>
                {group.required ? (
                  <span className="flex-shrink-0 text-caption text-faint">{t("siteWallet.always")}</span>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={t(group.titleKey)}
                    onClick={() => toggle(group.id)}
                    className={`relative flex h-5 w-[34px] flex-shrink-0 items-center rounded-full border px-0.5 transition-colors ${
                      on ? "border-foreground bg-foreground" : "border-line bg-mist"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-3.5 w-3.5 flex-shrink-0 rounded-full bg-background transition-transform motion-reduce:transition-none ${
                        on ? "translate-x-[14px]" : "translate-x-0"
                      }`}
                    />
                  </button>
                )}
              </div>
            );
          })}
        </section>

        <ScreenFooter>
          <p className="text-center text-caption leading-relaxed text-muted">
            {t("siteWallet.reloadNote")}
          </p>
          {useGleam.isError ? (
            <InlineError className="text-center">
              {useGleam.error instanceof Error ? errorText(useGleam.error) : t("siteWallet.switchFailed")}
            </InlineError>
          ) : null}
          <Button type="button" disabled={useGleam.isPending} onClick={submit}>
            {useGleam.isPending ? t("siteWallet.switching") : t("siteWallet.useGleamHere")}
          </Button>
        </ScreenFooter>
      </div>
    </div>
  );
}
