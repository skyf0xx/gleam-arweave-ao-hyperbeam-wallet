import type { Winston } from "./balance";
import { userErrorMessage } from "./user-errors";
import { isArweaveId } from "./arweave-id";

/** An AO NFT (a unique, non-fungible asset process) the wallet holds. */
export interface Collectible {
  /** The asset's process id. */
  id: string;
  name: string;
  ticker: string;
  contentType?: string;
  /** Set only when `contentType` is `image/*`, so it is safe to load through `<img>`. */
  imageUrl?: string;
  /** Set only when `contentType` is `video/*`, so it loads only through `<video>`. */
  videoUrl?: string;
  /** The asset's `Description` tag (ANS-110), trimmed. */
  description?: string;
  collectionId?: string;
  /** The collection process's own `Name` tag, or a shortened `collectionId` when it has none. */
  collectionName?: string;
  /**
   * Set on a Permaweb Name (`ao/names.ts`), whose `name` is then
   * `@<label>`. Only a name the namespace confirmed gets it, and only a
   * name starts with `@`: discovery strips it from every other asset.
   */
  permawebName?: PermawebName;
}

export interface PermawebName {
  label: string;
  /** The id the name points to. */
  target?: string;
  /** Escrowed into an open sale order, so it can't be sent. */
  listed?: true;
}

/** A single DNS label, so the name can be opened as a gateway subdomain. */
const DNS_LABEL = /^[a-z0-9_-]{1,63}$/;

/** `https://<label>.<gateway host>`, where the gateway serves the name's target; undefined when the label can't be a subdomain. */
export function nameSiteUrl(label: string, gatewayUrl: string): string | undefined {
  if (!DNS_LABEL.test(label)) return undefined;
  try {
    const gateway = new URL(gatewayUrl);
    return `${gateway.protocol}//${label}.${gateway.host}`;
  } catch {
    return undefined;
  }
}

/** The label of a collectible or ref named `@<label>`: only Permaweb Names are. */
export function permawebNameLabel(name: string | undefined): string | undefined {
  return name !== undefined && name.startsWith("@") && name.length > 1 ? name.slice(1) : undefined;
}

export type CollectibleKind = "image" | "video" | "audio" | "web" | "document" | "file";

const DOCUMENT_TYPES: ReadonlySet<string> = new Set(["application/pdf", "application/json"]);
const WEB_TYPES: ReadonlySet<string> = new Set(["text/html", "application/xhtml+xml", "application/x.arweave-manifest+json"]);

/** What a collectible's content is, from its content type, for a label where no preview shows. */
export function collectibleKind(contentType: string | undefined): CollectibleKind {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (WEB_TYPES.has(type)) return "web";
  if (type.startsWith("text/") || DOCUMENT_TYPES.has(type)) return "document";
  return "file";
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

/** A reviewed collectible send; `fee` is the quote the user saw, which becomes the transaction's reward. */
export interface CollectibleSendRequest extends CollectibleSendDraft {
  fee: Winston | null;
}

/** A popup request to point a held Permaweb Name at another id. */
export interface NameTargetDraft {
  walletId: string;
  /** The name's carrier process. */
  carrier: string;
  /** Shown as `@label`; never signed. */
  label: string;
  /** The id the name will point to. */
  target: string;
}

/** A reviewed name change; `fee` is the quote the user saw: the reward plus the 1 winston a set carries. */
export interface NameTargetRequest extends NameTargetDraft {
  fee: Winston | null;
}


/**
 * Why `sender` can't send collectible `assetId` to `recipient`, or null.
 * Shared by the popup's recipient check and the background, which checks
 * again before any network call.
 */
export function collectibleSendRefusal(req: { sender: string; recipient: string; assetId: string }): string | null {
  if (!isArweaveId(req.assetId)) return userErrorMessage("collectibleIdInvalid");
  if (!isArweaveId(req.recipient)) {
    return userErrorMessage("collectibleRecipientInvalid");
  }
  if (req.recipient === req.sender) return userErrorMessage("collectibleSendToSelf");
  if (req.recipient === req.assetId) return userErrorMessage("collectibleSendToAsset");
  return null;
}
