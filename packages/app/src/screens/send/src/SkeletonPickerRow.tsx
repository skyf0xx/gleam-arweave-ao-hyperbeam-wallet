
export function SkeletonPickerRow() {
  return (
    <div className="flex w-full items-center gap-2.5 px-3.5 py-3 phone:px-0">
      <div className="h-8 w-8 flex-shrink-0 gleam-shimmer rounded-full" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-3 w-20 gleam-shimmer rounded" />
        <div className="h-2.5 w-10 gleam-shimmer rounded" />
      </div>
    </div>
  );
}
