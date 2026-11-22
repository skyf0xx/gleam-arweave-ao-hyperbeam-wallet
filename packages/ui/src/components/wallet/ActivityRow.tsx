import { cn } from "../../primitives/cn";
import { useUiLabels } from "../../labels";
import { CollectibleThumbnail } from "./CollectibleThumbnail";

/**
 * An activity-feed row, reused verbatim on the "all activity" list.
 * `title`/`subtitle`/`amountLabel` are pre-formatted strings — truncated
 * addresses are acceptable here (a low-stakes, glanceable list); full
 * addresses belong on the detail screen and confirmation screens only.
 *
 * In silica, a pending row is fogged and clears once it settles
 * (`.gleam-pending-row` in theme.css).
 *
 * `activityType` is a locally declared string union, not an import of
 * `@gleam/core`'s `ActivityType` — `packages/ui` has no `@gleam/core`
 * dependency declared (it's presentational-only, matching every other
 * component in this directory). The two unions are kept structurally
 * identical by hand; a caller passing a `core` `ActivityType` value
 * satisfies this prop without a cast.
 */
export type ActivityRowType = "send" | "receive" | "upload" | "swap";

export interface ActivityRowProps {
  activityType: ActivityRowType;
  title: string;
  subtitle: string;
  /** Absent when the entry moved no amount it can state, such as an upload. */
  amountLabel?: string;
  /** The entry's result isn't known from its own transaction (a swap order), shown as a hollow circle where the amount would be. */
  outcomeUnknown?: boolean;
  amountTone?: "positive" | "negative" | "neutral";
  /** A collectible transfer shows the collectible's thumbnail where the amount would be. */
  collectible?: { name: string; imageUrl?: string };
  pending?: boolean;
  onClick?: () => void;
  /** Accessible name of the pending bar; English unless the caller passes its own. */
  pendingLabel?: string;
  className?: string;
}

const ICON_TONE_CLASSES: Record<ActivityRowType, string> = {
  receive: "text-positive",
  send: "text-foreground",
  upload: "text-muted",
  swap: "text-foreground",
};

export function ActivityRow({
  activityType,
  title,
  subtitle,
  amountLabel,
  amountTone = "neutral",
  outcomeUnknown = false,
  collectible,
  pending = false,
  onClick,
  pendingLabel,
  className,
}: ActivityRowProps) {
  const labels = useUiLabels();
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-pending={pending || undefined}
      className={cn(
        "gleam-pending-row flex w-full flex-col gap-2 rounded-lg px-3.5 py-3 text-left phone:-mx-3 phone:w-[calc(100%+1.5rem)] phone:px-3 phone:py-3.5",
        onClick && "cursor-pointer hover:bg-hover phone:active:bg-hover",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <div
          aria-hidden="true"
          className={cn(
            "gleam-pending-ink gleam-pending-icon flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full bg-mist",
            ICON_TONE_CLASSES[activityType],
          )}
        >
          <ActivityIcon type={activityType} />
        </div>
        <div className="gleam-pending-ink flex min-w-0 flex-1 flex-col gap-px">
          <div className="truncate text-label font-semibold text-foreground">{title}</div>
          <div className="text-caption text-muted">{subtitle}</div>
        </div>
        {collectible ? (
          <CollectibleThumbnail
            name={collectible.name}
            imageUrl={collectible.imageUrl}
            // Only a Permaweb Name is named `@<label>` (core `permawebNameLabel`; ui can't import core).
            nameLabel={collectible.name.startsWith("@") && collectible.name.length > 1 ? collectible.name.slice(1) : undefined}
            className="w-[30px] flex-shrink-0 rounded-md"
          />
        ) : outcomeUnknown ? (
          <span aria-hidden="true" className="mr-1 h-3 w-3 flex-shrink-0 rounded-full border-[1.5px] border-muted" />
        ) : amountLabel === undefined ? null : (
          <div className="gleam-pending-ink flex-shrink-0 text-label font-normal tabular-nums text-foreground">
            <span className={amountTone === "positive" ? "text-positive" : amountTone === "negative" ? "text-negative" : undefined}>
              {amountLabel}
            </span>
          </div>
        )}
      </div>
      {pending ? (
        <div
          role="progressbar"
          aria-label={pendingLabel ?? labels.pendingConfirmation}
          className="relative h-[3px] overflow-hidden rounded-sm bg-line"
        >
          <div className="gleam-beam-divider absolute inset-0 w-2/5 animate-[gleam-pending-sweep_1.4s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
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
  if (type === "swap") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
