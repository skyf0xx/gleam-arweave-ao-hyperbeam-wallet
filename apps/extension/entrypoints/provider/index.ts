import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import {
  APPROVAL_GATED_METHODS,
  APPROVAL_MAX_MS,
  EVENT,
  OTHER_WALLET,
  REQUEST,
  RESPONSE,
  SITE_MODE,
  SITE_MODE_REQUEST,
  PROVIDER_SURFACE_METHODS,
  decodeTaggedBinary,
  encodeTaggedBinary,
  type PageEventEnvelope,
  type PageMessageEnvelope,
  type PageOtherWalletEnvelope,
  type PageRequestEnvelope,
  type PageResponseEnvelope,
  type PageSiteModeRequestEnvelope,
  type ProviderSurfaceMethod,
} from "@gleam/messaging/src/page-protocol.ts";
// Named so Vite inlines only the version, not the whole package.json. WXT
// sets the manifest version from the same field.
import { version as WALLET_VERSION } from "../../package.json";

/**
 * The injected page-world script that installs `window.arweaveWallet`
 * (walletName "Gleam"). Loaded via `content.ts`'s
 * `injectScript("/provider.js", { keepInDom: false })` — never via
 * `world: "MAIN"` (Chromium-only, can't reach extension APIs the way
 * `injectScript`'s `<script src>` tag can via `web_accessible_resources`).
 *
 * Implements every item in the page ↔ content bridge list below, each
 * one a named vulnerability/bug if omitted:
 *
 * 1. `if (event.source !== window) return;` in the page-side listener —
 *    otherwise a same-document iframe could forge a response.
 * 2. `crypto.randomUUID()` per request, matched on the response's `id`.
 * 3. A `settled` flag per pending call, so a duplicate or late response
 *    (e.g. the content script relays twice) can't resolve/reject twice.
 * 4. A timeout that rejects — a hung/killed service worker must not hang
 *    the calling dApp forever. Methods that can open an approval window
 *    wait longer than the background's own approval timeout, so the dApp
 *    never sees a timeout for a request the user can still approve.
 * 5. `AbortSignal` support (an `options.signal` parameter accepted on
 *    every method). An abort only rejects the page-side promise. The
 *    bridge has no cancel message, and it must never post a real method
 *    such as `disconnect`: the background would run it and revoke the
 *    dApp's grant.
 * 6. Tagged binary encoding/decoding for `ArrayBuffer`/`Uint8Array`
 *    params and results, since neither survives `postMessage` intact in
 *    every embedding context this provider might run in.
 * 7. Owns the `window.arweaveWallet` slot but doesn't always answer
 *    through it. When another wallet extension (Wander, PermawebOS) is
 *    on the page, the slot holds a router that forwards each call to
 *    that wallet unless the user chose Gleam for the site (`SITE_MODE`
 *    from the content script, asked for only once another wallet shows
 *    up). The router reports the other wallet to the
 *    content script, so Gleam's popup can offer to take over on sites
 *    that actually use a wallet. Extension content scripts run in no
 *    guaranteed order, so the router captures a wallet that got there
 *    first, one that assigns the slot later, and one that redefines it
 *    and announces `arweaveWalletLoaded`. PermawebOS skips installing
 *    when the slot is taken, so it is also looked up at
 *    `window.permawebConnect`.
 * 8. Also exposes Gleam itself at `window.gleam`, which never forwards,
 *    so a dApp can offer its own "Connect with Gleam" button (README.md
 *    § For dApp developers).
 */
const REQUEST_TIMEOUT_MS = 60_000;
/** Leaves time to sign or post once the user approves at the last moment. */
const APPROVAL_REQUEST_TIMEOUT_MS = APPROVAL_MAX_MS + 60_000;

function timeoutFor(method: ProviderSurfaceMethod): number {
  return APPROVAL_GATED_METHODS.includes(method) ? APPROVAL_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}
const WALLET_NAME = "Gleam";

/**
 * arweave-js's `toJSON()` gives base64url `data` and drops `chunks`, which
 * would otherwise send the payload across twice.
 */
function serializeTransaction(transaction: unknown): unknown {
  const candidate = transaction as { toJSON?: unknown } | null | undefined;
  if (candidate && typeof candidate === "object" && typeof candidate.toJSON === "function") {
    return (candidate as { toJSON: () => unknown }).toJSON();
  }
  return transaction;
}

/**
 * arweave-js assigns the returned `tags` straight onto its `Transaction`.
 * Plain objects would replace its `Tag` instances, and
 * `getSignatureData()` (used by `transactions.verify`) calls `tag.get()`.
 * Signing never changes the tags, so the caller's own objects go back.
 */
function keepCallerTags(transaction: unknown, signed: unknown): unknown {
  const callerTags = (transaction as { tags?: unknown } | null | undefined)?.tags;
  const signedTags = (signed as { tags?: unknown } | null | undefined)?.tags;
  if (!Array.isArray(callerTags) || !Array.isArray(signedTags) || callerTags.length !== signedTags.length) {
    return signed;
  }
  const unchanged = callerTags.every((tag: { name?: unknown; value?: unknown } | null, index) => {
    const signedTag = signedTags[index] as { name?: unknown; value?: unknown } | null;
    return tag?.name === signedTag?.name && tag?.value === signedTag?.value;
  });
  return unchanged ? { ...(signed as object), tags: callerTags } : signed;
}

interface PendingCall {
  settled: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

class GleamProvider {
  readonly walletName = WALLET_NAME;
  readonly walletVersion = WALLET_VERSION;
  private readonly pending = new Map<string, PendingCall>();

  constructor() {
    window.addEventListener("message", (event: MessageEvent) => {
      // (1) Origin/source check — only ever trust messages this exact
      // window posted to itself (the content script relays into `window`
      // via `window.postMessage(..., "*")` targeting this same document,
      // never a message actually sent cross-frame).
      if (event.source !== window) return;

      const envelope = event.data as PageMessageEnvelope | undefined;
      if (!envelope || typeof envelope !== "object") return;

      if (envelope.type === RESPONSE) {
        this.handleResponse(envelope as PageResponseEnvelope);
      } else if (envelope.type === EVENT) {
        this.handleEvent(envelope as PageEventEnvelope);
      }
    });
  }

  private handleResponse(envelope: PageResponseEnvelope): void {
    const pending = this.pending.get(envelope.id);
    // (3) `settled` guard: a late/duplicate response for an id already
    // resolved (or already timed out) is dropped, never resolved twice.
    if (!pending || pending.settled) return;
    pending.settled = true;
    clearTimeout(pending.timeoutId);
    this.pending.delete(envelope.id);

    if (envelope.error) {
      pending.reject(new Error(envelope.error.message));
    } else {
      pending.resolve(decodeTaggedBinary(envelope.result));
    }
  }

  private handleEvent(envelope: PageEventEnvelope): void {
    window.dispatchEvent(new CustomEvent(envelope.event, { detail: envelope.data }));
  }

  /** (2)/(4)/(5): builds and dispatches one request, matched by a fresh id, with a timeout and abort support. */
  private call(method: ProviderSurfaceMethod, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) {
      return Promise.reject(new Error(`"${method}" was aborted before it was sent.`));
    }

    const id = crypto.randomUUID();
    const timeoutMs = timeoutFor(method);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const call = this.pending.get(id);
        if (!call || call.settled) return;
        call.settled = true;
        this.pending.delete(id);
        reject(new Error(`"${method}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const pendingCall: PendingCall = { settled: false, resolve, reject, timeoutId };
      this.pending.set(id, pendingCall);

      const onAbort = () => {
        if (pendingCall.settled) return;
        pendingCall.settled = true;
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(new Error(`"${method}" was aborted.`));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const request: PageRequestEnvelope = {
        type: REQUEST,
        id,
        method,
        params: encodeTaggedBinary(params),
      };
      window.postMessage(request, "*");
    });
  }

  connect(permissions?: unknown, appInfo?: unknown, gateway?: unknown): Promise<void> {
    return this.call("connect", { permissions, appInfo, gateway }).then(() => undefined);
  }

  disconnect(): Promise<void> {
    return this.call("disconnect", {}).then(() => undefined);
  }

  getPermissions(): Promise<unknown> {
    return this.call("getPermissions", {});
  }

  getActiveAddress(): Promise<unknown> {
    return this.call("getActiveAddress", {});
  }

  getAllAddresses(): Promise<unknown> {
    return this.call("getAllAddresses", {});
  }

  getActivePublicKey(): Promise<unknown> {
    return this.call("getActivePublicKey", {});
  }

  getWalletNames(): Promise<unknown> {
    return this.call("getWalletNames", {});
  }

  getArweaveConfig(): Promise<unknown> {
    return this.call("getArweaveConfig", {});
  }

  getBalances(): Promise<unknown> {
    return this.call("getBalances", {});
  }

  /** Every `options`-accepting method below pulls `signal` out of it (point 5) before forwarding the rest as params. */
  private static extractSignal(options: unknown): { signal?: AbortSignal; rest: unknown } {
    if (options !== null && typeof options === "object" && "signal" in options) {
      const { signal, ...rest } = options as { signal?: AbortSignal; [key: string]: unknown };
      return { signal, rest };
    }
    return { signal: undefined, rest: options };
  }

  async sign(transaction?: unknown, options?: unknown): Promise<unknown> {
    const { signal, rest } = GleamProvider.extractSignal(options);
    const signed = await this.call("sign", { transaction: serializeTransaction(transaction), options: rest }, signal);
    return keepCallerTags(transaction, signed);
  }

  dispatch(transaction?: unknown): Promise<unknown> {
    return this.call("dispatch", { transaction: serializeTransaction(transaction) });
  }

  encrypt(data?: unknown, options?: unknown): Promise<unknown> {
    const { signal, rest } = GleamProvider.extractSignal(options);
    return this.call("encrypt", { data, options: rest }, signal);
  }

  decrypt(data?: unknown, options?: unknown): Promise<unknown> {
    const { signal, rest } = GleamProvider.extractSignal(options);
    return this.call("decrypt", { data, options: rest }, signal);
  }

  signature(data?: unknown, options?: unknown): Promise<unknown> {
    const { signal, rest } = GleamProvider.extractSignal(options);
    return this.call("signature", { data, options: rest }, signal);
  }

  signMessage(data?: unknown, options?: unknown): Promise<unknown> {
    const { signal, rest } = GleamProvider.extractSignal(options);
    return this.call("signMessage", { data, options: rest }, signal);
  }

  privateHash(data?: unknown, options?: unknown): Promise<unknown> {
    const { signal, rest } = GleamProvider.extractSignal(options);
    return this.call("privateHash", { data, options: rest }, signal);
  }

  verifyMessage(data?: unknown, signature?: unknown, publicKey?: unknown, options?: unknown): Promise<unknown> {
    return this.call("verifyMessage", { data, signature, publicKey, options });
  }

  /** Resolves to the raw signed item as an `ArrayBuffer`, as Wander does. */
  signDataItem(dataItem?: unknown, options?: unknown): Promise<unknown> {
    const { signal, rest } = GleamProvider.extractSignal(options);
    return this.call("signDataItem", { dataItem, options: rest }, signal);
  }

  /**
   * AO token transfer, per `AoTokenTransferRequest`/`AoTokenTransferResult`
   * (`@gleam/core`'s `transfer.ts` models) — not part of ArConnect's own
   * surface, so no `options`/`signal` parameter to stay parallel with
   * `sign`/`dispatch`; the connection-approval/signing-approval flow is
   * identical either way.
   */
  transferAoTokens(request: { token: string; recipient: string; amount: string }): Promise<unknown> {
    return this.call("transferAoTokens", request);
  }

  /**
   * `type` and `gateway` are accepted for Wander's signature and ignored:
   * Gleam reads every AO token's balance the same way.
   */
  addToken(id: string, type?: unknown, gateway?: unknown): Promise<void> {
    void type;
    void gateway;
    return this.call("addToken", { id }).then(() => undefined);
  }

  isTokenAdded(id: string): Promise<unknown> {
    return this.call("isTokenAdded", { id });
  }

  /** Resolves to the balance as an atomic integer string, as Wander does. */
  tokenBalance(id: string): Promise<unknown> {
    return this.call("tokenBalance", { id });
  }

  /** `options.fetchBalance` adds each token's `balance`, as in Wander. */
  userTokens(options?: { fetchBalance?: boolean }): Promise<unknown> {
    return this.call("userTokens", { options });
  }

  /** Resolves to one `ArrayBuffer` per item, in order. */
  batchSignDataItem(dataItems?: unknown, options?: unknown): Promise<unknown> {
    const { signal, rest } = GleamProvider.extractSignal(options);
    return this.call("batchSignDataItem", { dataItems, options: rest }, signal);
  }
}

type WalletLike = Record<PropertyKey, unknown>;
type WalletWindow = { arweaveWallet?: unknown; permawebConnect?: unknown };

/**
 * How long a call to the other wallet waits to learn whether the site uses
 * Gleam instead. The content script answers "not Gleam" straight away when
 * it can't reach the background, so this only covers a reply that never
 * comes, and is long enough for a service worker's cold start.
 */
const SITE_MODE_WAIT_MS = 5_000;
const ROUTER_MARK = Symbol.for("gleam.arweaveWalletRouter");

function isWalletLike(value: unknown): value is WalletLike {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function isRouter(value: unknown): boolean {
  try {
    return isWalletLike(value) && value[ROUTER_MARK] === true;
  } catch {
    return false;
  }
}

function claimSlot(router: unknown, onAssign: (value: unknown) => void): boolean {
  try {
    Object.defineProperty(window, "arweaveWallet", {
      get: () => router,
      // A wallet that installs by plain assignment is captured rather than
      // dropped, and its strict-mode script doesn't throw.
      set: onAssign,
      configurable: true,
      enumerable: true,
    });
    return true;
  } catch {
    // Another script made the slot non-configurable first. Nothing can
    // replace it, and throwing here would only break the page.
    return false;
  }
}

/** Returns a teardown that stops listening and reclaiming the slot, for tests. */
function install(): () => void {
  const gleamProvider = new GleamProvider();
  const gleam = gleamProvider as unknown as WalletLike;
  const walletWindow = window as unknown as WalletWindow;
  try {
    // Read-only, so a page script or another wallet can't swap it out by
    // assignment.
    Object.defineProperty(window, "gleam", { value: gleamProvider, configurable: true, enumerable: true, writable: false });
  } catch {
    // Something made `window.gleam` non-configurable first; leave it alone.
  }
  let captured: WalletLike | null = null;
  // Null until the content script says whether this site holds a grant.
  let useGleam: boolean | null = null;
  let resolveMode: () => void = () => undefined;
  const modeKnown = new Promise<void>((resolve) => {
    resolveMode = resolve;
  });
  let reportedPresence = false;
  let reportedUse = false;
  let modeTimeout: ReturnType<typeof setTimeout> | undefined;

  const other = (): WalletLike | null => {
    if (captured) return captured;
    const permaweb = walletWindow.permawebConnect;
    return isWalletLike(permaweb) && !isRouter(permaweb) ? permaweb : null;
  };

  const report = (used: boolean): void => {
    const wallet = other();
    if (!wallet || (used ? reportedUse : reportedPresence)) return;
    reportedPresence = true;
    if (used) reportedUse = true;
    const walletName =
      wallet === walletWindow.permawebConnect ? "PermawebOS" : typeof wallet.walletName === "string" ? wallet.walletName : "";
    const envelope: PageOtherWalletEnvelope = { type: OTHER_WALLET, walletName, used };
    window.postMessage(envelope, location.origin);
  };

  const setMode = (value: boolean): void => {
    useGleam = value;
    clearTimeout(modeTimeout);
    resolveMode();
  };

  const requestMode = (): void => {
    if (modeTimeout !== undefined || useGleam !== null) return;
    modeTimeout = setTimeout(() => {
      if (useGleam === null) setMode(false);
    }, SITE_MODE_WAIT_MS);
    const envelope: PageSiteModeRequestEnvelope = { type: SITE_MODE_REQUEST };
    window.postMessage(envelope, location.origin);
  };

  const noteOther = (): void => {
    if (!other()) return;
    report(false);
    requestMode();
  };

  const target = (): WalletLike => (useGleam === true ? gleam : (other() ?? gleam));

  const invoke = (prop: PropertyKey, args: unknown[]): unknown => {
    const wallet = target();
    const method = wallet[prop];
    if (typeof method !== "function") {
      throw new TypeError(`window.arweaveWallet.${String(prop)} is not a function.`);
    }
    if (wallet !== gleam) report(true);
    return (method as (...rest: unknown[]) => unknown).apply(wallet, args);
  };

  // One function per name, so a dApp that cached `arweaveWallet.connect`
  // still reaches whichever wallet the site uses at call time.
  const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  const methodFor = (prop: PropertyKey) => {
    let method = methods.get(prop);
    if (!method) {
      method = (...args: unknown[]) => {
        if (useGleam !== null || !other()) return invoke(prop, args);
        noteOther();
        return modeKnown.then(() => invoke(prop, args));
      };
      methods.set(prop, method);
    }
    return method;
  };

  const router = new Proxy(Object.create(null) as WalletLike, {
    get(_shell, prop) {
      if (prop === ROUTER_MARK) return true;
      const value = Reflect.get(target(), prop);
      return typeof value === "function" ? methodFor(prop) : value;
    },
    has(_shell, prop) {
      return prop in target();
    },
    set(_shell, prop, value) {
      return Reflect.set(target(), prop, value);
    },
    ownKeys() {
      return Reflect.ownKeys(target());
    },
    // The shell has no own properties, so each one is reported as
    // configurable, which a Proxy may do for a property its target lacks.
    getOwnPropertyDescriptor(_shell, prop) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target(), prop);
      if (!descriptor) return undefined;
      const value = typeof descriptor.value === "function" ? methodFor(prop) : descriptor.value;
      return "value" in descriptor ? { ...descriptor, value, configurable: true } : { ...descriptor, configurable: true };
    },
  });

  const capture = (value: unknown): void => {
    if (!isWalletLike(value) || isRouter(value) || value === gleam) return;
    captured = value;
    noteOther();
  };

  capture(walletWindow.arweaveWallet);
  if (!claimSlot(router, capture)) return () => undefined;

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window) return;
    const data = event.data as PageMessageEnvelope | undefined;
    if (data?.type === SITE_MODE && typeof data.useGleam === "boolean") setMode(data.useGleam);
  };
  const reclaim = (): void => {
    const current = walletWindow.arweaveWallet;
    if (current === router) return;
    capture(current);
    claimSlot(router, capture);
  };
  window.addEventListener("message", onMessage);
  window.addEventListener("arweaveWalletLoaded", reclaim);
  // PermawebOS never assigns the slot once it's taken, so it is looked for
  // again once its injected script has had the chance to run.
  window.addEventListener("DOMContentLoaded", noteOther, { once: true });
  window.dispatchEvent(new CustomEvent("arweaveWalletLoaded"));
  return () => {
    clearTimeout(modeTimeout);
    window.removeEventListener("message", onMessage);
    window.removeEventListener("arweaveWalletLoaded", reclaim);
    window.removeEventListener("DOMContentLoaded", noteOther);
  };
}

// `defineUnlistedScript` is imported explicitly from `wxt/utils/
// define-unlisted-script` (a pure, side-effect-free factory — see that
// module's own source) rather than relied on as WXT's unimport-injected
// global: the global only exists inside WXT's own build/dev pipeline,
// never under plain Vitest, so `provider.provider.test.ts` couldn't
// import this file at all without a real static import here. Same
// reasoning applies to `content.ts`'s `defineContentScript` and
// `background.ts`'s `defineBackground`.
export default defineUnlistedScript(() => {
  install();
});

// Exports for `provider.provider.test.ts`, which exercises the real
// `window.postMessage`/`addEventListener` round trip against jsdom's
// `window` directly (no extension context needed for any of it).
export { GleamProvider, install, PROVIDER_SURFACE_METHODS };
