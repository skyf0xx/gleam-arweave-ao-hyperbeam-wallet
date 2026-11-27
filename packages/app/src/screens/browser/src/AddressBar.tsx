import { useT } from "../../../i18n";
import type { SiteHost } from "./address";

export interface AddressBarProps {
  host: SiteHost | null;
  /** Path segments to show after the host (`pageTrail`). */
  trail: string[];
  onEdit: () => void;
}

/** The open page's address, which a tap turns into the address field. */
export function AddressBar({ host, trail, onEdit }: AddressBarProps) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("browser.addressEdit", { host: host?.host ?? "" })}
      onClick={onEdit}
      className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-mist px-3.5 text-body text-foreground"
    >
      {host?.insecure ? (
        <span className="flex flex-shrink-0 items-center gap-1 text-label font-semibold text-warning">
          <WarningIcon />
          {t("browser.notSecure")}
        </span>
      ) : null}
      {/* The host is what to trust, so the path gives way first. */}
      <span className="max-w-full flex-shrink-0 truncate">{host?.host ?? ""}</span>
      {trail.length > 0 ? (
        <span aria-hidden="true" className="min-w-0 truncate text-label text-muted">
          {trail.map((segment) => `› ${segment}`).join(" ")}
        </span>
      ) : null}
    </button>
  );
}

function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 2 20h20L12 3ZM12 10v4M12 17h.01" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
