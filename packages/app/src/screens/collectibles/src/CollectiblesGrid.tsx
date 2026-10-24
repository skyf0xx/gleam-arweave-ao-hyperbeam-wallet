import type { Collectible } from "@gleam/core";
import { CollectibleThumbnail, EmptyState, SkeletonTile } from "@gleam/ui/src/components/wallet/index.ts";
import { groupCollectibles } from "./groupCollectibles";

export interface CollectiblesGridProps {
  items: Collectible[] | undefined;
  loading: boolean;
  onOpen: (collectible: Collectible) => void;
}

const SKELETON_TILES = 6;

export function CollectiblesGrid({ items, loading, onOpen }: CollectiblesGridProps) {
  if (loading && items === undefined) {
    return (
      <Grid>
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <SkeletonTile key={index} />
        ))}
      </Grid>
    );
  }
  if (!items || items.length === 0) {
    return <EmptyState message="No collectibles yet. NFTs you hold on AO show up here." />;
  }

  const { groups, ungrouped } = groupCollectibles(items);
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.collectionId} aria-label={group.name} className="flex flex-col gap-2.5">
          <h3 className="truncate text-label font-semibold text-muted">{group.name}</h3>
          <Grid>
            {group.items.map((item) => (
              <Tile key={item.id} item={item} onOpen={onOpen} />
            ))}
          </Grid>
        </section>
      ))}
      {ungrouped.length > 0 ? (
        <section aria-label={groups.length > 0 ? "Other" : "Collectibles"} className="flex flex-col gap-2.5">
          {groups.length > 0 ? <h3 className="text-label font-semibold text-muted">Other</h3> : null}
          <Grid>
            {ungrouped.map((item) => (
              <Tile key={item.id} item={item} onOpen={onOpen} />
            ))}
          </Grid>
        </section>
      ) : null}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-x-3 gap-y-4">{children}</div>;
}

function Tile({ item, onOpen }: { item: Collectible; onOpen: (collectible: Collectible) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={item.name}
      className="flex min-w-0 flex-col gap-1.5 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
    >
      <CollectibleThumbnail name={item.name} imageUrl={item.imageUrl} />
      <span className="block truncate text-caption text-foreground">{item.name}</span>
    </button>
  );
}
