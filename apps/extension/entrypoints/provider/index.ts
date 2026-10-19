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
  PROVIDER_EVENT,
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
 * 2. A fresh random id per request (`requestId`), matched on the
 *    response's `id`.
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
 *    `window.permawebConnect`, and Gleam announces it. Since another
 *    wallet may still be on its way, a call made before
 *    `OTHER_WALLET_SETTLE_MS` past DOMContentLoaded waits, and so does
 *    Gleam's own `arweaveWalletLoaded`.
 * 8. Also exposes Gleam itself at `window.gleam`, which never forwards,
 *    so a dApp can offer its own "Connect with Gleam" button (README.md
 *    § For dApp developers). It is announced at once with
 *    `gleamWalletLoaded`.
 * 9. Answers a dApp's PermawebOS button when PermawebOS isn't installed:
 *    an empty `window.permawebConnect` slot gets a shim that calls Gleam
 *    (`permawebConnectShim`). PermawebOS's injected script redefines the
 *    slot unconditionally and announces `permawebConnectLoaded`, so the
 *    shim is configurable and steps aside, like the router yielding to
 *    Wander.
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

/**
 * 128 random bits as hex. Not `crypto.randomUUID()`: that exists only in
 * secure contexts, so on a plain-http page it would throw before the
 * request reached the background's "secure (https) sites" refusal.
 */
function requestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
      // via `window.postMessage(..., location.origin)` to this same document,
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

    const id = requestId();
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
      // Targeted at this document's own origin, so the request is dropped
      // if the window has navigated elsewhere by the time it is delivered.
      window.postMessage(request, location.origin);
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
/**
 * How long after DOMContentLoaded another wallet's injected script may
 * still run. Extensions inject a `<script src>` with `async = false`,
 * which can run after DOMContentLoaded on a short page. Until then, a call
 * made with no other wallet in sight waits instead of going to Gleam.
 */
const OTHER_WALLET_SETTLE_MS = 150;
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

/**
 * What PermawebOS's dApp SDK checks before it treats `window.permawebConnect`
 * as a wallet (`walletVersion`, `events.on`/`off` and every one of these
 * as a function). Its connect button then calls only `connect`,
 * `disconnect` and the reads behind `getSnapshot`.
 */
const PERMAWEB_CONNECT_METHODS = [
  "connect",
  "disconnect",
  "getPermissions",
  "getActiveAddress",
  "getActivePublicKey",
  "getAllAddresses",
  "getWalletNames",
  "getArweaveConfig",
  "signMessage",
  "verifyMessage",
  "signature",
  "privateHash",
  "encrypt",
  "decrypt",
  "signDataItem",
  "batchSignDataItem",
  "sign",
  "dispatch",
] as const satisfies readonly (ProviderSurfaceMethod & keyof GleamProvider)[];

type PermawebListener = (payload: unknown) => void;

/**
 * The events the SDK's `subscribe` listens for on `permawebConnect.events`,
 * each fed from the window event Gleam already posts. Gleam has no
 * permissions-change event, so `permissions` never fires; the SDK reads
 * permissions again through `getPermissions`.
 */
const PERMAWEB_EVENT_SOURCES: Record<string, ReadonlyArray<[string, (detail: unknown) => unknown]>> = {
  connect: [[PROVIDER_EVENT.CONNECT, () => null]],
  disconnect: [[PROVIDER_EVENT.DISCONNECT, () => null]],
  activeAddress: [
    [PROVIDER_EVENT.CONNECT, (detail) => (detail as { activeAddress?: unknown } | null)?.activeAddress],
    [PROVIDER_EVENT.WALLET_SWITCH, (detail) => (detail as { address?: unknown } | null)?.address],
  ],
};

/** A `window.permawebConnect` in PermawebOS's shape whose every call goes to Gleam. */
function permawebConnectShim(gleam: GleamProvider): WalletLike {
  const bridges = new Map<PermawebListener, Array<[string, EventListener]>>();
  const events = {
    on(name: unknown, listener: unknown): void {
      if (typeof name !== "string" || typeof listener !== "function") return;
      const sources = PERMAWEB_EVENT_SOURCES[name] ?? [];
      const added = sources.map(([windowEvent, read]): [string, EventListener] => {
        const bridge: EventListener = (event) => {
          const payload = read((event as CustomEvent).detail);
          if (name !== "activeAddress" || typeof payload === "string") (listener as PermawebListener)(payload);
        };
        window.addEventListener(windowEvent, bridge);
        return [windowEvent, bridge];
      });
      bridges.set(listener as PermawebListener, [...(bridges.get(listener as PermawebListener) ?? []), ...added]);
    },
    off(name: unknown, listener: unknown): void {
      if (typeof name !== "string" || typeof listener !== "function") return;
      const sourceEvents = (PERMAWEB_EVENT_SOURCES[name] ?? []).map(([windowEvent]) => windowEvent);
      const kept = (bridges.get(listener as PermawebListener) ?? []).filter(([windowEvent, bridge]) => {
        if (!sourceEvents.includes(windowEvent)) return true;
        window.removeEventListener(windowEvent, bridge);
        return false;
      });
      bridges.set(listener as PermawebListener, kept);
    },
  };
  const shim: WalletLike = { walletName: WALLET_NAME, walletVersion: WALLET_VERSION, events };
  for (const method of PERMAWEB_CONNECT_METHODS) {
    shim[method] = (...args: unknown[]) => (gleam[method] as (...rest: unknown[]) => unknown).apply(gleam, args);
  }
  return Object.freeze(shim);
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
  let permawebShim: WalletLike | null = null;
  if (!("permawebConnect" in window)) {
    const shim = permawebConnectShim(gleamProvider);
    try {
      // Configurable, so PermawebOS's own `defineProperty` replaces it.
      Object.defineProperty(window, "permawebConnect", { value: shim, configurable: true, enumerable: true, writable: false });
      permawebShim = shim;
    } catch {
      // Taken between the check and the define; leave it to its owner.
    }
  }
  const shimHoldsPermaweb = (): boolean => permawebShim !== null && walletWindow.permawebConnect === permawebShim;
  let captured: WalletLike | null = null;
  // Null until the content script says whether this site holds a grant.
  let useGleam: boolean | null = null;
  // False until every wallet extension's injected script has had the chance
  // to run. Before then, no other wallet in sight doesn't mean there is none.
  let settled = false;
  let waiters: Array<() => void> = [];
  // The wallet the last `arweaveWalletLoaded` was for, so each wallet that
  // ends up behind the slot is announced once. Undefined until the first.
  let announced: WalletLike | null | undefined;
  let dispatching = false;
  let reportedPresence = false;
  let reportedUse = false;
  // The last permission list reported, joined, so each change is sent once.
  let reportedPermissions = "";
  let modeTimeout: ReturnType<typeof setTimeout> | undefined;
  let settleTimeout: ReturnType<typeof setTimeout> | undefined;

  const isSurfaceMethod = (prop: PropertyKey): boolean =>
    typeof prop === "string" && (PROVIDER_SURFACE_METHODS as readonly string[]).includes(prop);

  const other = (): WalletLike | null => {
    if (captured) return captured;
    const permaweb = walletWindow.permawebConnect;
    return isWalletLike(permaweb) && !isRouter(permaweb) && permaweb !== permawebShim ? permaweb : null;
  };

  /** Whether a call made now reaches the wallet the site will keep using. */
  const decided = (): boolean => useGleam === true || (other() ? useGleam !== null : settled);

  const wake = (): void => {
    if (!decided()) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };

  const nameOf = (wallet: WalletLike): string =>
    wallet === walletWindow.permawebConnect ? "PermawebOS" : typeof wallet.walletName === "string" ? wallet.walletName : "";

  const report = (used: boolean): void => {
    const wallet = other();
    if (!wallet || (used ? reportedUse : reportedPresence)) return;
    reportedPresence = true;
    if (used) reportedUse = true;
    const envelope: PageOtherWalletEnvelope = { type: OTHER_WALLET, walletName: nameOf(wallet), used };
    window.postMessage(envelope, location.origin);
  };

  const reportPermissions = (value: unknown): void => {
    const wallet = other();
    if (!wallet || !Array.isArray(value)) return;
    const permissions = value.filter((permission): permission is string => typeof permission === "string");
    const key = permissions.join(",");
    if (permissions.length === 0 || key === reportedPermissions) return;
    reportedPermissions = key;
    const envelope: PageOtherWalletEnvelope = { type: OTHER_WALLET, walletName: nameOf(wallet), used: true, permissions };
    window.postMessage(envelope, location.origin);
  };

  const setMode = (value: boolean): void => {
    useGleam = value;
    clearTimeout(modeTimeout);
    wake();
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

  const whenDecided = (): Promise<void> => {
    noteOther();
    return new Promise((resolve) => {
      waiters.push(resolve);
      wake();
    });
  };

  const target = (): WalletLike => (useGleam === true ? gleam : (other() ?? gleam));

  const invoke = (prop: PropertyKey, args: unknown[]): unknown => {
    const wallet = target();
    const method = wallet[prop];
    if (typeof method !== "function") {
      throw new TypeError(`window.arweaveWallet.${String(prop)} is not a function.`);
    }
    // Only a wallet API call counts as the site using the wallet. Any script
    // can call `toString` or poke the other wallet's own helpers, and the
    // popup would then offer Gleam on pages that never touch a wallet.
    const forwarded = wallet !== gleam && isSurfaceMethod(prop);
    if (forwarded) report(true);
    if (forwarded && prop === "connect") reportPermissions(args[0]);
    const result = (method as (...rest: unknown[]) => unknown).apply(wallet, args);
    if (forwarded && prop === "getPermissions") {
      Promise.resolve(result).then(reportPermissions, () => undefined);
    }
    return result;
  };

  // One function per name, so a dApp that cached `arweaveWallet.connect`
  // still reaches whichever wallet the site uses at call time.
  const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  const methodFor = (prop: PropertyKey) => {
    let method = methods.get(prop);
    if (!method) {
      method = (...args: unknown[]) => {
        if (decided()) return invoke(prop, args);
        return whenDecided().then(() => invoke(prop, args));
      };
      methods.set(prop, method);
    }
    return method;
  };

  // Until the site's wallet is known, a feature check such as
  // `"signMessage" in arweaveWallet` sees every method either wallet has,
  // and the method waits to call the right one. A sync value such as
  // `walletName` can't wait, so it comes from the likelier wallet: the
  // other one when it is on the page, since a site uses Gleam only once
  // the user picks it there.
  const eitherHasMethod = (prop: PropertyKey): boolean => isSurfaceMethod(prop) || typeof other()?.[prop] === "function";

  const router = new Proxy(Object.create(null) as WalletLike, {
    get(_shell, prop) {
      if (prop === ROUTER_MARK) return true;
      const value = Reflect.get(target(), prop);
      if (typeof value === "function" || (value === undefined && !decided() && eitherHasMethod(prop))) {
        return methodFor(prop);
      }
      return value;
    },
    has(_shell, prop) {
      return prop in target() || (!decided() && eitherHasMethod(prop));
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

  const announce = (): void => {
    const wallet = other();
    if (announced !== undefined && announced === wallet) return;
    announced = wallet;
    dispatching = true;
    try {
      window.dispatchEvent(new CustomEvent("arweaveWalletLoaded"));
    } finally {
      dispatching = false;
    }
  };

  const capture = (value: unknown): void => {
    if (!isWalletLike(value) || isRouter(value) || value === gleam) return;
    captured = value;
    noteOther();
    wake();
  };

  capture(walletWindow.arweaveWallet);
  if (!claimSlot(router, capture)) return () => undefined;

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window) return;
    const data = event.data as PageMessageEnvelope | undefined;
    if (data?.type === SITE_MODE && typeof data.useGleam === "boolean") setMode(data.useGleam);
  };
  const reclaim = (): void => {
    if (dispatching) return;
    const current = walletWindow.arweaveWallet;
    if (current !== router) {
      capture(current);
      claimSlot(router, capture);
    }
    // The other wallet's own event has just told the page. This listener
    // was added before any page script's, so they already read the router.
    if (other()) announced = other();
  };
  // PermawebOS skips a taken slot and announces `arweaveWalletLoaded` only
  // while it holds the slot itself, so Gleam announces it instead.
  const onPermawebLoaded = (): void => {
    // Gleam's own announcement of the shim, not PermawebOS arriving.
    if (shimHoldsPermaweb()) return;
    noteOther();
    if (settled) announce();
  };
  const settle = (): void => {
    settled = true;
    noteOther();
    wake();
    announce();
    // Like `arweaveWalletLoaded`, held until PermawebOS has had its chance
    // to take the slot, so a dApp hears about the shim only in its absence.
    if (shimHoldsPermaweb()) window.dispatchEvent(new CustomEvent("permawebConnectLoaded"));
  };
  const scheduleSettle = (): void => {
    settleTimeout = setTimeout(settle, OTHER_WALLET_SETTLE_MS);
  };
  window.addEventListener("message", onMessage);
  window.addEventListener("arweaveWalletLoaded", reclaim);
  window.addEventListener("permawebConnectLoaded", onPermawebLoaded);
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", scheduleSettle, { once: true });
  } else {
    scheduleSettle();
  }
  window.dispatchEvent(new CustomEvent("gleamWalletLoaded"));
  // A wallet that installed first is already behind the slot, so the page
  // can hear about it now. Otherwise the shared event waits for the settle,
  // so a dApp's handler doesn't take Gleam for the only wallet.
  if (other()) announce();
  return () => {
    clearTimeout(modeTimeout);
    clearTimeout(settleTimeout);
    window.removeEventListener("message", onMessage);
    window.removeEventListener("arweaveWalletLoaded", reclaim);
    window.removeEventListener("permawebConnectLoaded", onPermawebLoaded);
    window.removeEventListener("DOMContentLoaded", scheduleSettle);
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
