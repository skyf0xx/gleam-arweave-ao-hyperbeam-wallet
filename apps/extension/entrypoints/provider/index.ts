import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import {
  EVENT,
  REQUEST,
  RESPONSE,
  PROVIDER_SURFACE_METHODS,
  decodeTaggedBinary,
  encodeTaggedBinary,
  type PageEventEnvelope,
  type PageMessageEnvelope,
  type PageRequestEnvelope,
  type PageResponseEnvelope,
  type ProviderSurfaceMethod,
} from "@gleam/messaging/src/page-protocol.ts";

/**
 * The injected page-world script that installs `window.arweaveWallet`
 * (ARCHITECTURE.md §4.4, walletName "Gleam"). Loaded via `content.ts`'s
 * `injectScript("/provider.js", { keepInDom: false })` — never via
 * `world: "MAIN"` (Chromium-only, can't reach extension APIs the way
 * `injectScript`'s `<script src>` tag can via `web_accessible_resources`).
 *
 * Implements every item in ARCHITECTURE.md §4.3's page ↔ content bridge
 * list, each one a named vulnerability/bug if omitted:
 *
 * 1. `if (event.source !== window) return;` in the page-side listener —
 *    otherwise a same-document iframe could forge a response.
 * 2. `crypto.randomUUID()` per request, matched on the response's `id`.
 * 3. A `settled` flag per pending call, so a duplicate or late response
 *    (e.g. the content script relays twice) can't resolve/reject twice.
 * 4. A timeout that rejects — a hung/killed service worker must not hang
 *    the calling dApp forever.
 * 5. `AbortSignal` support (an `options.signal` parameter accepted on
 *    every method) — posts a distinct cancel message on abort so the
 *    content script can tell the background to give up waiting too.
 * 6. Tagged binary encoding/decoding for `ArrayBuffer`/`Uint8Array`
 *    params and results, since neither survives `postMessage` intact in
 *    every embedding context this provider might run in.
 * 7. Never clobbers an existing `window.arweaveWallet` — if one is
 *    already installed (a competing wallet extension), this provider
 *    installs nothing and leaves it alone entirely.
 */
const REQUEST_TIMEOUT_MS = 60_000;
const WALLET_NAME = "Gleam";

interface PendingCall {
  settled: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

class GleamProvider {
  readonly walletName = WALLET_NAME;
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

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const call = this.pending.get(id);
        if (!call || call.settled) return;
        call.settled = true;
        this.pending.delete(id);
        reject(new Error(`"${method}" timed out after ${REQUEST_TIMEOUT_MS}ms.`));
      }, REQUEST_TIMEOUT_MS);

      const pendingCall: PendingCall = { settled: false, resolve, reject, timeoutId };
      this.pending.set(id, pendingCall);

      const onAbort = () => {
        if (pendingCall.settled) return;
        pendingCall.settled = true;
        clearTimeout(timeoutId);
        this.pending.delete(id);
        // (5) Tells the content script/background to stop waiting too,
        // rather than only rejecting this side's promise.
        window.postMessage({ type: REQUEST, id, method: "disconnect", params: { cancelOf: id } }, "*");
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

  sign(transaction?: unknown, options?: unknown): Promise<unknown> {
    const { signal, rest } = GleamProvider.extractSignal(options);
    return this.call("sign", { transaction, options: rest }, signal);
  }

  dispatch(transaction?: unknown): Promise<unknown> {
    return this.call("dispatch", { transaction });
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

  signDataItem(dataItem?: unknown): Promise<unknown> {
    return this.call("signDataItem", { dataItem });
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

  batchSignDataItem(dataItems?: unknown): Promise<unknown> {
    return this.call("batchSignDataItem", { dataItems });
  }
}

function install(): void {
  // (7) Never clobber an existing provider — if a competing wallet
  // extension already installed `window.arweaveWallet`, this provider
  // does nothing further.
  if ((window as unknown as { arweaveWallet?: unknown }).arweaveWallet) {
    return;
  }

  const api = new GleamProvider();
  Object.defineProperty(window, "arweaveWallet", {
    value: api,
    configurable: true,
    writable: true,
  });
  window.dispatchEvent(new CustomEvent("arweaveWalletLoaded"));
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
