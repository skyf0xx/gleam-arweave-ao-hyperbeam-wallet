/**
 * A skeleton placeholder row matching `TokenRow`/`ActivityRow`'s layout
 * (cross-cutting-states.html's `.skeleton-row` / TODO.md 8.2: "structural
 * skeleton placeholders... not spinners" as the loading default).
 * Respects `prefers-reduced-motion` via the `motion-reduce:` variant.
 */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-2.5 border-b border-[#e5e5e5] py-3 last:border-b-0">
      <div className="h-[30px] w-[30px] flex-shrink-0 animate-pulse rounded-lg bg-[#e5e5e5] motion-reduce:animate-none motion-reduce:opacity-70" />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="h-[11px] w-[65%] animate-pulse rounded-md bg-[#e5e5e5] motion-reduce:animate-none motion-reduce:opacity-70" />
        <div className="h-[11px] w-[40%] animate-pulse rounded-md bg-[#e5e5e5] motion-reduce:animate-none motion-reduce:opacity-70" />
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
        <div className="h-[11px] w-12 animate-pulse rounded-md bg-[#e5e5e5] motion-reduce:animate-none motion-reduce:opacity-70" />
        <div className="h-[11px] w-12 animate-pulse rounded-md bg-[#e5e5e5] motion-reduce:animate-none motion-reduce:opacity-70" />
      </div>
    </div>
  );
}
