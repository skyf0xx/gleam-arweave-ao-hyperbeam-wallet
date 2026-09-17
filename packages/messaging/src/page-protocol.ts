/**
 * Page ↔ content postMessage envelope constants, per ARCHITECTURE.md §4.3.
 * The bridge implementation (the provider script's `call()`, the content
 * script's relay) is the `provider-bridge` layer's job — this layer only
 * pins the wire shape both sides will speak.
 */
export const REQUEST = "GLEAM_API_CALL";
export const RESPONSE = "GLEAM_API_RESPONSE";
export const EVENT = "GLEAM_EVENT";

/**
 * The ArConnect-compatible method surface injected as `window.arweaveWallet`
 * (PRD §3 Glossary — Provider surface; ARCHITECTURE.md §4.2's
 * `PROVIDER_METHODS`). A page-originated message can only ever reach this
 * set — never `KEY_METHODS`/`APPROVAL_METHODS` — enforced at the
 * dispatcher choke point built in a later layer.
 * See https://github.com/wanderwallet/wander-docs/tree/main/api for details
 */
export const PROVIDER_SURFACE_METHODS = [
  "connect",
  "disconnect",
  "getPermissions",
  "getActiveAddress",
  "getAllAddresses",
  "getActivePublicKey",
  "getWalletNames",
  "getArweaveConfig",
  "getBalances",
  "sign",
  "dispatch",
  "encrypt",
  "decrypt",
  "signature",
  "signMessage",
  "privateHash",
  "verifyMessage",
  "signDataItem",
  "batchSignDataItem",
  "transferAoTokens",
] as const;

export type ProviderSurfaceMethod = (typeof PROVIDER_SURFACE_METHODS)[number];

/**
 * Tagged binary encoding for values that don't survive the postMessage
 * boundary intact (ARCHITECTURE.md §4.3 point 6).
 */
export interface TaggedArrayBuffer {
  __gleamType: "ArrayBuffer";
  data: number[];
}

export interface TaggedUint8Array {
  __gleamType: "Uint8Array";
  data: number[];
}

export type TaggedBinary = TaggedArrayBuffer | TaggedUint8Array;

/**
 * A page → content script request envelope. `id` is generated with
 * `crypto.randomUUID()` per request and matched on the response
 * (ARCHITECTURE.md §4.3 point 2).
 */
export interface PageRequestEnvelope {
  type: typeof REQUEST;
  id: string;
  method: ProviderSurfaceMethod;
  params: unknown;
}

export interface PageResponseEnvelope {
  type: typeof RESPONSE;
  id: string;
  result?: unknown;
  error?: { message: string };
}

/**
 * An unsolicited push from the extension to the page — e.g. an
 * `activeAddress` or `disconnect` event ArConnect-compatible dApps listen
 * for via `window.addEventListener("arweaveWalletLoaded" | ...)`.
 */
export interface PageEventEnvelope {
  type: typeof EVENT;
  event: string;
  data: unknown;
}

export type PageMessageEnvelope =
  | PageRequestEnvelope
  | PageResponseEnvelope
  | PageEventEnvelope;
