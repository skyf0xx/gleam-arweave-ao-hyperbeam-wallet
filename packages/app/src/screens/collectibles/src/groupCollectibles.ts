import type { Collectible } from "@gleam/core";

export interface CollectibleGroup {
  collectionId: string;
  name: string;
  items: Collectible[];
}

export interface GroupedCollectibles {
  groups: CollectibleGroup[];
  /** Singles and items with no collection, in their original order. */
  ungrouped: Collectible[];
}

/**
 * A collection earns a heading only when the wallet holds at least two of
 * its items; a lone item is just another tile. Groups appear in the order
 * their first item does.
 */
export function groupCollectibles(items: Collectible[]): GroupedCollectibles {
  const byCollection = new Map<string, Collectible[]>();
  for (const item of items) {
    if (!item.collectionId) continue;
    const bucket = byCollection.get(item.collectionId);
    if (bucket) bucket.push(item);
    else byCollection.set(item.collectionId, [item]);
  }

  const groups: CollectibleGroup[] = [];
  const emitted = new Set<string>();
  const ungrouped: Collectible[] = [];
  for (const item of items) {
    const id = item.collectionId;
    const bucket = id ? byCollection.get(id) : undefined;
    if (id && bucket && bucket.length >= 2) {
      if (emitted.has(id)) continue;
      emitted.add(id);
      groups.push({ collectionId: id, name: bucket.find((entry) => entry.collectionName)?.collectionName ?? id, items: bucket });
    } else {
      ungrouped.push(item);
    }
  }
  return { groups, ungrouped };
}
