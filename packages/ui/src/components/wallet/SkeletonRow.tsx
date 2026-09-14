/**
 * A skeleton placeholder row matching `TokenRow`/`ActivityRow`'s layout
 * (cross-cutting-states.html's `.skeleton-row` / TODO.md 8.2: "structural
 * skeleton placeholders... not spinners" as the loading default).
 * Respects `prefers-reduced-motion` via the `.gleam-shimmer` class's own
 * `@media` override (see `packages/ui/src/tokens/theme.css`).
 */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3 last:border-b-0">
      <div className="h-[30px] w-[30px] flex-shrink-0 gleam-shimmer rounded-lg" />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="h-[11px] w-[65%] gleam-shimmer rounded-md" />
        <div className="h-[11px] w-[40%] gleam-shimmer rounded-md" />
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
        <div className="h-[11px] w-12 gleam-shimmer rounded-md" />
        <div className="h-[11px] w-12 gleam-shimmer rounded-md" />
      </div>
    </div>
  );
}
