/** An AO NFT (a unique, non-fungible asset process) the wallet holds. */
export interface Collectible {
  /** The asset's process id. */
  id: string;
  name: string;
  ticker: string;
  contentType?: string;
  /** Set only when `contentType` is `image/*`, so it is safe to load through `<img>`. */
  imageUrl?: string;
  collectionId?: string;
  /** The collection process's own `Name` tag, or a shortened `collectionId` when it has none. */
  collectionName?: string;
}
