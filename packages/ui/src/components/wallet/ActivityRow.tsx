import { cn } from "../../primitives/cn";

/**
 * An activity-feed row (wallet-main-screen.html's `.row` with
 * `.activity-icon.{received,sent,upload}`, reused verbatim on the "all
 * activity" list per TODO.md 4.3). `title`/`subtitle`/`amountLabel` are
 * pre-formatted strings — truncated addresses are acceptable here (a
 * low-stakes, glanceable list) per brand/voice.md's truncation rule; full
 * addresses belong on the detail screen and confirmation screens only.
 *
 * `activityType` is a locally declared string union, not an import of
 * `@gleam/core`'s `ActivityType` — `packages/ui` has no `@gleam/core`
 * dependency declared (it's presentational-only, matching every other
 * component in this directory), and adding one is a `package.json`/
 * lockfile change outside this task's ALLOWED SCOPE (the same
 * shared-workspace-config gap class `onboarding-unlock` flagged for
 * `@webext-core/messaging`). The two unions are kept structurally
 * identical by hand; a caller passing a `core` `ActivityType` value
 * satisfies this prop without a cast.
 */
export type ActivityRowType = "send" | "receive" | "upload";

export interface ActivityRowProps {
  activityType: ActivityRowType;
  title: string;
  subtitle: string;
  amountLabel: string;
  amountTone?: "positive" | "neutral";
  pending?: boolean;
  onClick?: () => void;
  className?: string;
}

const ICON_TONE_CLASSES: Record<ActivityRowType, string> = {
  receive: "text-positive",
  send: "text-foreground",
  upload: "text-muted",
};

export function ActivityRow({
  activityType,
  title,
  subtitle,
  amountLabel,
  amountTone = "neutral",
  pending = false,
  onClick,
  className,
}: ActivityRowProps) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-2 border-b border-line px-3.5 py-3 text-left last:border-b-0",
        onClick && "cursor-pointer hover:bg-mist",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <div
          aria-hidden="true"
          className={cn(
            "flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border border-line bg-mist",
            ICON_TONE_CLASSES[activityType],
          )}
        >
          <ActivityIcon type={activityType} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="truncate text-label font-semibold text-foreground">{title}</div>
          <div className="text-caption text-muted">{subtitle}</div>
        </div>
        <div className="flex-shrink-0 text-label font-semibold tabular-nums text-foreground">
          <span className={amountTone === "positive" ? "text-positive" : undefined}>
            {amountLabel}
          </span>
        </div>
      </div>
      {pending ? (
        <div
          role="progressbar"
          aria-label="Pending confirmation"
          className="relative h-[3px] overflow-hidden rounded-sm bg-line"
        >
          <div className="gleam-beam-divider absolute inset-0 w-2/5 animate-[beam-sweep_1.4s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
        </div>
      ) : null}
    </Component>
  );
}

function ActivityIcon({ type }: { type: ActivityRowType }) {
  if (type === "receive") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5v14M12 19l-6-6M12 19l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "send") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15V3M12 3l-4 4M12 3l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
