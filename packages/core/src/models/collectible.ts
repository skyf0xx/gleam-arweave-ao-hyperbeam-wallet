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

/**
 * What a send or an activity entry keeps of a collectible. `name` and
 * `imageUrl` are missing on an entry built from the gateway alone, which
 * only knows the asset's process id.
 */
export interface CollectibleRef {
  id: string;
  name?: string;
  imageUrl?: string;
}

/** A popup request to send one collectible. */
export interface CollectibleSendDraft {
  walletId: string;
  recipient: string;
  collectible: CollectibleRef;
}

const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/;

/**
 * Why `sender` can't send collectible `assetId` to `recipient`, or null.
 * Shared by the popup's recipient check and the background, which checks
 * again before any network call.
 */
export function collectibleSendRefusal(req: { sender: string; recipient: string; assetId: string }): string | null {
  if (!ARWEAVE_ID.test(req.assetId)) return "This collectible's process id isn't a valid Arweave id.";
  if (!ARWEAVE_ID.test(req.recipient)) {
    return "That doesn't look like a full Arweave address: check for a missing character.";
  }
  if (req.recipient === req.sender) return "That's this wallet's own address. Send to a different address.";
  if (req.recipient === req.assetId) return "That's the collectible's own address. Enter the recipient's wallet address.";
  return null;
}
