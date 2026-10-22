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
  const bodyClass = "flex min-w-0 flex-1 flex-col gap-0.5 py-3 pl-3.5 text-left";

  let body: ReactNode;
  if (notice.kind === "invites") {
    body = (
      <button type="button" className={bodyClass} onClick={onOpenPoints}>
        <NoticeContent title="You have new invites" text="Share them from Points" />
      </button>
    );
  } else {
    const { title, text, url } = notice.announcement;
    const content = <NoticeContent title={title} text={text} critical={critical} />;
    body = url ? (
      <a href={url} target="_blank" rel="noreferrer" className={bodyClass}>
        {content}
      </a>
    ) : (
      <div className={bodyClass}>{content}</div>
    );
  }

  return (
    <section
      aria-label="Notice"
      role={critical ? "alert" : undefined}
      className={cn(
        "mx-5 mb-1 flex items-start rounded-xl border",
        critical ? "border-warning-border bg-warning-surface" : "border-line bg-mist",
      )}
    >
      {body}
      <button
        type="button"
        aria-label="Dismiss"
        className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center text-muted hover:text-foreground"
        onClick={dismiss}
      >
        <CloseIcon />
      </button>
    </section>
  );
}

interface NoticeContentProps {
  title?: string;
  text: string;
  critical?: boolean;
}

/** A bold title over muted text; without a title the text takes the foreground. */
function NoticeContent({ title, text, critical = false }: NoticeContentProps) {
  return (
    <>
      {title ? (
        <span className="flex items-center gap-1.5 text-body font-semibold leading-snug text-foreground">
          {critical ? <WarningIcon /> : null}
          <span className="min-w-0">{title}</span>
        </span>
      ) : null}
      <span
        className={cn(
          "flex items-center gap-1 leading-snug",
          title ? "text-label text-muted" : "text-body text-foreground",
        )}
      >
        {critical && !title ? <WarningIcon /> : null}
        <span className="min-w-0">{text}</span>
      </span>
    </>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
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
