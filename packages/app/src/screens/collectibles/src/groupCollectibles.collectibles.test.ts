import { describe, expect, it } from "vitest";
import type { Collectible } from "@gleam/core";
import { groupCollectibles } from "./groupCollectibles";

function item(id: string, collectionId?: string, collectionName?: string): Collectible {
  return { id, name: `Item ${id}`, ticker: "NFT", collectionId, collectionName };
}

describe("groupCollectibles", () => {
  it("returns nothing for an empty list", () => {
    expect(groupCollectibles([])).toEqual({ groups: [], ungrouped: [] });
  });

  it("groups a collection the wallet holds two or more items from", () => {
    const { groups, ungrouped } = groupCollectibles([item("a", "c1", "Frogs"), item("b", "c2"), item("c", "c1", "Frogs")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ collectionId: "c1", name: "Frogs" });
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(ungrouped.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("leaves single-item collections and collectionless items ungrouped, in order", () => {
    const { groups, ungrouped } = groupCollectibles([item("a", "c1", "Frogs"), item("b"), item("c", "c2", "Owls")]);
    expect(groups).toEqual([]);
    expect(ungrouped.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("orders groups by first appearance and falls back to the collection id for a name", () => {
    const { groups } = groupCollectibles([item("a", "c2"), item("b", "c1", "Frogs"), item("c", "c2"), item("d", "c1", "Frogs")]);
    expect(groups.map((group) => group.collectionId)).toEqual(["c2", "c1"]);
    expect(groups[0]?.name).toBe("c2");
  });
});
