import type { ReactNode } from "react";
import { Sheet } from "@gleam/ui/src/primitives/sheet.tsx";
import { CheckIcon, CopyIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";
import { useCopy } from "@gleam/ui/src/primitives/use-copy.ts";
import { useT } from "../../../i18n";
import type { AddressParts } from "./address-parts";

export interface AddressSheetProps {
  parts: AddressParts | null;
  open: boolean;
  onClose: () => void;
  container: HTMLElement | null;
}

/** The open page's address taken apart, one part per row, under the site it belongs to. */
export function AddressSheet({ parts, open, onClose, container }: AddressSheetProps) {
  const t = useT();
  const { copied, copy } = useCopy(parts?.href ?? "");
  return (
    <Sheet open={open && parts !== null} onOpenChange={(next) => !next && onClose()} label={t("browser.address")} container={container}>
      {parts ? (
        <div className="flex flex-col gap-5 px-5 pb-6 pt-3">
          <div className="flex flex-col gap-1.5">
            <p className="break-all text-h2 font-semibold text-foreground">
              {parts.site}
              {parts.port ? <span className="font-normal text-muted">{`:${parts.port}`}</span> : null}
            </p>
            <p className={parts.insecure ? "text-label font-semibold text-warning" : "text-label text-muted"}>
              {parts.insecure ? t("browser.notSecureHttp") : "https"}
            </p>
          </div>
          <dl className="flex flex-col gap-3.5">
            {parts.subdomain ? <Row label={t("browser.subdomain")}>{parts.subdomain}</Row> : null}
            {parts.path.length > 0 ? (
              <Row label={t("browser.path")}>
                {parts.path.map((segment, index) => (
                  <span key={index} className="block">
                    <span className="text-faint">/</span>
                    {segment}
                  </span>
                ))}
              </Row>
            ) : null}
            {parts.query.length > 0 ? (
              <Row label={t("browser.query")}>
                {parts.query.map((pair, index) => (
                  <span key={index} className="block">
                    <span className="text-muted">{pair.key}</span>
                    {pair.value ? (
                      <>
                        <span className="text-faint"> = </span>
                        {pair.value}
                      </>
                    ) : null}
                  </span>
                ))}
              </Row>
            ) : null}
            {parts.fragment ? <Row label={t("browser.fragment")}>{parts.fragment}</Row> : null}
          </dl>
          <button
            type="button"
            onClick={copy}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-mist text-body font-semibold text-foreground"
          >
            {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            {copied ? t("browser.copied") : t("browser.copyAddress")}
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-20 flex-shrink-0 text-label text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-mono text-label text-foreground">{children}</dd>
    </div>
  );
}
