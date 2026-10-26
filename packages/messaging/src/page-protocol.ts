/**
 * Page ↔ content postMessage envelope constants. The bridge
 * implementation (the provider script's `call()`, the content script's
 * relay) is a later layer's job — this layer only pins the wire shape
 * both sides will speak.
 */
export const REQUEST = "GLEAM_API_CALL";
export const RESPONSE = "GLEAM_API_RESPONSE";
export const EVENT = "GLEAM_EVENT";
/** Content script → page: whether this site uses Gleam over another installed wallet. */
export const SITE_MODE = "GLEAM_SITE_MODE";
/**
 * Page → content script: asks for `SITE_MODE`. Sent only once another
 * wallet is on the page, so a page with Gleam alone never wakes the
 * background just by loading.
 */
export const SITE_MODE_REQUEST = "GLEAM_SITE_MODE_REQUEST";
/** Page → content script: another wallet is on the page, and whether the page has called it. */
export const OTHER_WALLET = "GLEAM_OTHER_WALLET";

/**
 * The mobile dApp view's page → native channel: the provider sends each
 * envelope as JSON text through `webkit.messageHandlers[name].postMessage`
 * on iOS and `window[name].postMessage` on Android.
 */
export const NATIVE_BRIDGE_HANDLER = "gleamDappView";
/**
 * The window `CustomEvent` type the mobile dApp view delivers the wallet's
 * envelopes with, as JSON text in `detail`.
 */
export const NATIVE_BRIDGE_EVENT = "gleamdappview";

/**
 * The ArConnect-compatible method surface injected as
 * `window.arweaveWallet`: core's `PROVIDER_METHODS` plus
 * `REFUSED_PROVIDER_METHODS`, which stay defined so a dApp gets a clear
 * error. A page-originated message can only ever reach
 * this set — never `KEY_METHODS`/`APPROVAL_METHODS` — enforced at the
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
  "tokenBalance",
  "userTokens",
  "addToken",
  "isTokenAdded",
] as const;

export type ProviderSurfaceMethod = (typeof PROVIDER_SURFACE_METHODS)[number];

/** How long the background waits for the user to answer an approval window. */
export const APPROVAL_TIMEOUT_MS = 5 * 60_000;

/**
 * How long a scan attestation waits for an answer. Longer than
 * `APPROVAL_TIMEOUT_MS`: the user reads a report of up to 20,000
 * characters and may join Gleam Points first, and a hardware join opens
 * a second window.
 */
export const SCAN_ATTESTATION_TIMEOUT_MS = 20 * 60_000;

/**
 * The longest an approval can stay open, counted from when it was
 * created. A hardware wallet's request waits past `APPROVAL_TIMEOUT_MS`
 * while the page reports device activity, since a Ledger app can take
 * minutes to open the first time.
 */
export const APPROVAL_MAX_MS = 15 * 60_000;

/**
 * Methods that can open an approval window. The page must wait at least
 * as long as the background can (`APPROVAL_MAX_MS`) for them: a shorter page timeout would
 * report a failure to the dApp while an approval that still signs, or
 * `dispatch` still posts, is open.
 */
export const APPROVAL_GATED_METHODS: readonly ProviderSurfaceMethod[] = [
  "connect",
  "sign",
  "dispatch",
  "encrypt",
  "decrypt",
  "signMessage",
  "signDataItem",
  "batchSignDataItem",
  "transferAoTokens",
  "addToken",
];

/** Tagged binary encoding for values that don't survive the postMessage boundary intact. */
export interface TaggedArrayBuffer {
  __gleamType: "ArrayBuffer";
  data: number[];
}

export interface TaggedUint8Array {
  __gleamType: "Uint8Array";
  data: number[];
}

export type TaggedBinary = TaggedArrayBuffer | TaggedUint8Array;

export function isTaggedBinary(value: unknown): value is TaggedBinary {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<TaggedBinary>;
  return (
    (candidate.__gleamType === "ArrayBuffer" || candidate.__gleamType === "Uint8Array") &&
    Array.isArray(candidate.data)
  );
}

// `instanceof` is avoided on purpose: WebCrypto results, page values and
// test globals can each come from a different realm.
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Replaces every `ArrayBuffer` and typed-array view with a `TaggedBinary`.
 * Needed on both hops: `postMessage` between page and content script, and
 * the JSON serialization of extension messaging and `chrome.storage`.
 */
export function encodeTaggedBinary(value: unknown): unknown {
  if (isArrayBuffer(value)) {
    return { __gleamType: "ArrayBuffer", data: Array.from(new Uint8Array(value)) } satisfies TaggedArrayBuffer;
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { __gleamType: "Uint8Array", data: Array.from(bytes) } satisfies TaggedUint8Array;
  }
  if (Array.isArray(value)) {
    return value.map(encodeTaggedBinary);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeTaggedBinary(entry)]));
  }
  return value;
}

/** The inverse of `encodeTaggedBinary`. */
export function decodeTaggedBinary(value: unknown): unknown {
  if (isTaggedBinary(value)) {
    const bytes = Uint8Array.from(value.data);
    return value.__gleamType === "ArrayBuffer" ? bytes.buffer : bytes;
  }
  if (Array.isArray(value)) {
    return value.map(decodeTaggedBinary);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decodeTaggedBinary(entry)]));
  }
  return value;
}

/**
 * A page → content script request envelope. `id` is a fresh random hex
 * string per request, matched on the response.
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
 * `handleEvent` (page-side provider script) carry. `walletSwitch`
 * matches Wander's own naming for an active-account change;
 * `connect`/`disconnect` mirror the provider surface method names of
 * the same events, the convention ArConnect-compatible dApps already
 * listen for.
 *
 * Wiring `postProviderEvent` to actually fire on connect/disconnect/
 * switchWallet, and filtering delivery to only origins holding an active
 * `Grant`, is a later layer's job — this layer only pins the payload
 * shape each named event carries.
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
 * Fired when a dApp's Grant for the current origin is revoked or
 * expires — carries no payload, matching ArConnect's own `disconnect`
 * event, which signals only that access ended, not any residual wallet
 * state.
 */
export type DisconnectEventPayload = Record<string, never>;

/**
 * Fired when the wallet's active account changes while a dApp remains
 * connected (`switchWallet`, `ProtocolMap.switchWallet`). Carries the
 * newly active address, matching Wander's own `walletSwitch` event
 * shape (`{ address: string }`).
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
 * for. `event`/`data` stay a generic `string`/`unknown` pairing (rather
 * than a generic-parameterized envelope) because this envelope crosses
 * `postMessage`, which erases type parameters at the JSON-serialization
 * boundary; `ProviderEventMap` is what a caller building or consuming
 * one of these should key `data`'s shape against for a given `event`.
 */
export interface PageEventEnvelope {
  type: typeof EVENT;
  event: string;
  data: unknown;
}

export interface PageSiteModeRequestEnvelope {
  type: typeof SITE_MODE_REQUEST;
}

export interface PageSiteModeEnvelope {
  type: typeof SITE_MODE;
  useGleam: boolean;
}

/**
 * Sent once when the provider first sees the other wallet (`used: false`)
 * and once when the page first calls it (`used: true`). A page can forge
 * this for itself to make Gleam's popup offer "Use Gleam here" on that
 * site. Taking the offer is still the user's choice, made in the popup
 * with the permissions spelled out, and every signature still opens its
 * own approval window.
 *
 * `permissions` comes with a use when the page asks the other wallet to
 * `connect`, or reads what it already holds with `getPermissions`. "Use
 * Gleam here" preselects those, so the site doesn't find a permission
 * missing and ask for a second connect. A forged list only changes which
 * switches start on.
 */
export interface PageOtherWalletEnvelope {
  type: typeof OTHER_WALLET;
  walletName: string;
  used: boolean;
  permissions?: string[];
}

export type PageMessageEnvelope =
  | PageRequestEnvelope
  | PageResponseEnvelope
  | PageEventEnvelope
  | PageSiteModeRequestEnvelope
  | PageSiteModeEnvelope
  | PageOtherWalletEnvelope;
