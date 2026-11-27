import { useEffect, useRef } from "react";
import { useT } from "../../../i18n";
import type { AddressParts } from "./address-parts";

/** How the full address is on show: a peek while the bar is held, or the sheet from the info button. */
export type AddressReveal = "none" | "peek" | "sheet";

export interface AddressBarProps {
  parts: AddressParts | null;
  /** Path segments to show after the host (`pageTrail`). */
  trail: string[];
  onEdit: () => void;
  reveal: AddressReveal;
  onReveal: (reveal: AddressReveal) => void;
}

const HOLD_MS = 300;

/**
 * The open page's address. A tap edits it, holding it peeks at the full
 * address, and the info button opens its parts.
 */
export function AddressBar({ parts, trail, onEdit, reveal, onReveal }: AddressBarProps) {
  const t = useT();
  const holdTimer = useRef<number | undefined>(undefined);
  // A hold that peeked ends in a click, which mustn't also start editing.
  const held = useRef(false);
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  const startHold = () => {
    held.current = false;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      onReveal("peek");
    }, HOLD_MS);
  };
  const endHold = () => {
    window.clearTimeout(holdTimer.current);
    if (held.current && reveal === "peek") onReveal("none");
  };
  const tap = () => {
    if (held.current) {
      held.current = false;
      return;
    }
    onEdit();
  };

  const host = parts ? `${parts.subdomain ? `${parts.subdomain}.` : ""}${parts.site}` : "";
  return (
    <div className="relative flex min-w-0 flex-1">
      <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-xl bg-mist">
        <button
          type="button"
          aria-label={t("browser.addressEdit", { host })}
          onClick={tap}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onContextMenu={(event) => event.preventDefault()}
          className="flex min-h-11 min-w-0 flex-1 select-none items-center justify-center gap-2 pl-3.5 text-body text-foreground [-webkit-touch-callout:none]"
        >
          {parts?.insecure ? (
            <span className="flex flex-shrink-0 items-center gap-1 text-label font-semibold text-warning">
              <WarningIcon />
              {t("browser.notSecure")}
            </span>
          ) : null}
          {/* The site is who runs the page, so the path gives way first, then the subdomain, cut from its start. */}
          <span className="flex min-w-0 items-baseline">
            {parts?.subdomain ? (
              <span dir="rtl" className="min-w-0 truncate text-muted">
                <span dir="ltr" className="[unicode-bidi:isolate]">{`${parts.subdomain}.`}</span>
              </span>
            ) : null}
            <span className="max-w-full flex-shrink-0 truncate font-semibold">{parts?.site ?? ""}</span>
          </span>
          {trail.length > 0 ? (
            <span aria-hidden="true" className="min-w-0 shrink-[1000] truncate text-label text-muted">
              {trail.map((segment) => `› ${segment}`).join(" ")}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          aria-label={t("browser.showFullAddress")}
          onClick={() => onReveal("sheet")}
          disabled={parts === null}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-muted disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
        >
          <InfoIcon />
        </button>
      </div>
      {reveal === "peek" && parts ? (
        <div className="absolute inset-x-0 top-full z-20 mt-2 flex flex-col gap-2.5 rounded-2xl bg-surface px-4 pb-4 pt-3.5 shadow-lg">
          <p className="break-all text-h3 font-semibold text-foreground">{parts.site}</p>
          <FullAddress parts={parts} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The whole address, wrapping only after `/`, `?` and `&`, with the site
 * picked out so it reads mid-line.
 */
function FullAddress({ parts }: { parts: AddressParts }) {
  return (
    <p className="break-all font-mono text-label leading-relaxed text-muted">
      <span>{parts.scheme}</span>
      {parts.subdomain ? <span>{`${parts.subdomain}.`}</span> : null}
      <span className="rounded bg-mist px-0.5 font-semibold text-foreground">{parts.site}</span>
      {parts.port ? <span>{`:${parts.port}`}</span> : null}
      {parts.path.map((segment, index) => (
        <span key={`p${index}`}>
          <span className="text-faint">/</span>
          <wbr />
          <span className="text-foreground">{segment}</span>
        </span>
      ))}
      {parts.query.map((pair, index) => (
        <span key={`q${index}`}>
          <wbr />
          <span className="text-faint">{index === 0 ? "?" : "&"}</span>
          <span>{pair.key}</span>
          {pair.value ? (
            <>
              <span className="text-faint">=</span>
              <span className="text-foreground">{pair.value}</span>
            </>
          ) : null}
        </span>
      ))}
      {parts.fragment ? (
        <>
          <wbr />
          <span>{`#${parts.fragment}`}</span>
        </>
      ) : null}
    </p>
  );
}

const stroke = { stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 2 20h20L12 3ZM12 10v4M12 17h.01" {...stroke} />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" {...stroke} strokeWidth={1.75} />
      <path d="M12 11v5M12 7.5v.01" {...stroke} strokeWidth={1.75} />
    </svg>
  );
}
