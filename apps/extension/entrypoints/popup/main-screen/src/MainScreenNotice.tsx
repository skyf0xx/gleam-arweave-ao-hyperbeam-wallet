import type { ReactNode } from "react";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { useNotice } from "./useNotice";

export interface MainScreenNoticeProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onOpenPoints: () => void;
}

/**
 * The slot above the balance: at most one dismissible notice, nothing
 * when there is none. Warning red marks a `critical` announcement only;
 * the beam is identity and never a severity signal.
 */
export function MainScreenNotice({ runtime, wallet, onOpenPoints }: MainScreenNoticeProps) {
  const { notice, dismiss } = useNotice(runtime, wallet);
  if (notice === null) return null;

  const critical = notice.kind === "announcement" && notice.announcement.level === "critical";
  const bodyClass = "flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-3 text-left text-label leading-snug text-foreground";

  let body: ReactNode;
  if (notice.kind === "invites") {
    body = (
      <button type="button" className={bodyClass} onClick={onOpenPoints}>
        You have new invites
      </button>
    );
  } else {
    const { text, url } = notice.announcement;
    const content = (
      <>
        {critical ? <WarningIcon /> : null}
        <span className="min-w-0">{text}</span>
      </>
    );
    body = url ? (
      <a href={url} target="_blank" rel="noreferrer" className={cn(bodyClass, "underline decoration-faint underline-offset-2")}>
        {content}
      </a>
    ) : (
      <p className={bodyClass}>{content}</p>
    );
  }

  return (
    <section
      aria-label="Notice"
      role={critical ? "alert" : undefined}
      className={cn(
        "mx-5 mb-1 flex items-stretch rounded-lg border",
        critical ? "border-warning-border bg-warning-surface" : "border-line bg-background",
      )}
    >
      {body}
      <button
        type="button"
        aria-label="Dismiss"
        className="flex w-8 flex-shrink-0 items-center justify-center text-body text-faint hover:text-foreground"
        onClick={dismiss}
      >
        ×
      </button>
    </section>
  );
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="flex-shrink-0 text-warning">
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
