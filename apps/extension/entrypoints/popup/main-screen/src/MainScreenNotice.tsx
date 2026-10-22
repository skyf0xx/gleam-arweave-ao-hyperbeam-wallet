import type { ReactNode } from "react";
import { browser } from "wxt/browser";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { sitePageUrl, STORE_REVIEWS_URL } from "@/src/site-pages";
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
  } else if (notice.kind === "review") {
    body = <ReviewPrompt onAnswer={dismiss} className={bodyClass} />;
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

/**
 * The one-time store review ask, shown after a good moment. Every user
 * gets the same two links whatever they'd answer, and nothing is offered
 * for a review: the store's policy forbids filtering and incentives. Feedback sits beside it for anyone with a
 * complaint rather than praise.
 */
function ReviewPrompt({ onAnswer, className }: { onAnswer: () => void; className: string }) {
  return (
    <div className={cn(className, "gap-3 pb-3.5")}>
      <span className="flex flex-col gap-0.5">
        <NoticeContent title="Enjoying Gleam?" text="Leave a review to help others discover us." />
      </span>
      <span className="flex items-center gap-4">
        <Button asChild variant="secondary" size="sm">
          <a href={STORE_REVIEWS_URL} target="_blank" rel="noreferrer" onClick={onAnswer}>
            Leave a review
            <span aria-hidden="true">↗</span>
          </a>
        </Button>
        <a
          href={sitePageUrl("feedback", browser.runtime.getManifest().version)}
          target="_blank"
          rel="noreferrer"
          onClick={onAnswer}
          className="text-label text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          Send us feedback
        </a>
      </span>
    </div>
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
