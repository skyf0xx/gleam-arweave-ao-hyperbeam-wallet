/** Placeholder for a collectible tile, with the same shimmer as `SkeletonRow`. */
export function SkeletonTile() {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="aspect-square w-full gleam-shimmer rounded-lg" />
      <div className="h-[11px] w-[70%] gleam-shimmer rounded-md" />
    </div>
  );
}
