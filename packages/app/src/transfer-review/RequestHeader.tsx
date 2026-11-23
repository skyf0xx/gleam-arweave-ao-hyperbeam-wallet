import { useState } from "react";
import { WALLET_APPROVAL_ORIGIN } from "@gleam/core";

/** `https://` and the rest, so the scheme can sit back while the host carries the weight. */
export function splitOrigin(origin: string): { scheme: string; host: string } {
  try {
    const url = new URL(origin);
    if (url.host) return { scheme: `${url.protocol}//`, host: url.host };
  } catch {
    // Not a URL: shown whole below.
  }
  return { scheme: "", host: origin };
}

/**
 * The top of every approval: who is asking and what kind of request it is.
 * The origin is shown whole and wraps instead of truncating, since a
 * lookalike host hides in a cut-off tail. Gleam's own requests show the
 * Gleam mark instead of a site.
 */
export function RequestHeader({ origin, requestType, icon }: { origin: string; requestType: string; icon?: string | null }) {
  const own = origin === WALLET_APPROVAL_ORIGIN;
  const { scheme, host } = splitOrigin(origin);
  const [iconFailed, setIconFailed] = useState(false);
  return (
    <div className="flex items-center gap-3 px-6 pt-5 phone:px-5">
      {own ? (
        <div aria-hidden="true" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-foreground">
          <div className="gleam-beam-divider w-[18px] rounded-none" />
        </div>
      ) : icon && !iconFailed ? (
        <div aria-hidden="true" className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-mist">
          <img src={icon} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover dark:opacity-90" onError={() => setIconFailed(true)} />
        </div>
      ) : (
        <div aria-hidden="true" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-mist text-body font-semibold text-muted">
          {(host.replace(/^www\./, "").charAt(0) || "?").toUpperCase()}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="break-all text-body font-semibold leading-snug text-foreground">
          {own ? (
            "Gleam"
          ) : (
            <>
              {scheme ? <span className="font-normal text-muted">{scheme}</span> : null}
              <span>{host}</span>
            </>
          )}
        </span>
        <span className="text-label text-muted">{requestType}</span>
      </div>
    </div>
  );
}
