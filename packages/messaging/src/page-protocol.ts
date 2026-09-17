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
 * The provider-event names `postProviderEvent` (content script) and
 * `handleEvent` (page-side provider script) already carry as idle
 * plumbing — never invoked or dispatched yet — per this task's INTENT.
 * `walletSwitch` matches Wander's own naming for an active-account
 * change (ArConnect docs / `wanderwallet/wander-docs`'s API reference);
 * `connect`/`disconnect` mirror the provider surface method names of the
 * same events, the same convention ArConnect-compatible dApps already
 * listen for.
 *
 * Wiring `postProviderEvent` to actually fire on connect/disconnect/
 * switchWallet, and filtering delivery to only origins holding an active
 * `Grant` (this task's RELEVANT RULES access-control invariant), is a
 * later provider-bridge/wallet-core layer's job — this layer only pins
 * the payload shape each named event carries.
 */
export const PROVIDER_EVENT = {
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  WALLET_SWITCH: "walletSwitch",
} as const;

export type ProviderEventName = (typeof PROVIDER_EVENT)[keyof typeof PROVIDER_EVENT];

/**
 * Fired once a dApp's `connect()` call resolves (or an existing Grant is
 * reconfirmed) — mirrors ArConnect's post-connect notification. Carries
 * the newly active address the page can now request via
 * `getActiveAddress()`, so the page never has to round-trip just to learn
 * what it already implicitly knows from the resolved `connect()` call.
 */
export interface ConnectEventPayload {
  activeAddress: string;
}

/**
 * Fired when a dApp's Grant for the current origin is revoked or expires
 * (`revokeGrant`, or the later provider-bridge layer's own lifecycle
 * logic) — carries no payload, matching ArConnect's own `disconnect`
 * event, which signals only that access ended, not any residual wallet
 * state.
 */
export type DisconnectEventPayload = Record<string, never>;

/**
 * Fired when the wallet's active account changes while a dApp remains
 * connected (`switchWallet`, `ProtocolMap.switchWallet`) — the
 * `walletSwitch`-equivalent event this task's INTENT names. Carries the
 * newly active address, matching Wander's own `walletSwitch` event
 * shape (`{ address: string }` in `wanderwallet/wander-docs`).
 */
export interface WalletSwitchEventPayload {
  address: string;
}

/**
 * The discriminated event/payload pairing `postProviderEvent` and
 * `handleEvent` must agree on. Access control (only a connected origin —
 * one holding an active Grant — ever receives any of these) is enforced
 * at the call site by a later layer; this type says nothing about origin
 * because the event, once posted into a given page's own window via
 * `postMessage`, is inherently scoped to that page already — the
 * invariant lives in *whether* an event is sent to a given tab/origin at
 * all, not in the payload shape.
 */
export type ProviderEventMap = {
  [PROVIDER_EVENT.CONNECT]: ConnectEventPayload;
  [PROVIDER_EVENT.DISCONNECT]: DisconnectEventPayload;
  [PROVIDER_EVENT.WALLET_SWITCH]: WalletSwitchEventPayload;
};

/**
 * An unsolicited push from the extension to the page — e.g. a
 * `walletSwitch` or `disconnect` event ArConnect-compatible dApps listen
 * for via `window.addEventListener("arweaveWalletLoaded" | ...)`. `event`/
 * `data` stay a generic `string`/`unknown` pairing (rather than a
 * generic-parameterized envelope) because this envelope also crosses
 * `postMessage`, which erases type parameters at the JSON-serialization
 * boundary the same way `PageRequestEnvelope`/`PageResponseEnvelope`
 * already do; `ProviderEventMap` is what a caller building or consuming
 * one of these should key `data`'s shape against for a given `event`.
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
