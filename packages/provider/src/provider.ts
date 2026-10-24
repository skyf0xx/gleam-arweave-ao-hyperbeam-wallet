import {
  APPROVAL_GATED_METHODS,
  APPROVAL_MAX_MS,
  decodeTaggedBinary,
  encodeTaggedBinary,
  type ProviderSurfaceMethod,
} from "@gleam/messaging/src/page-protocol.ts";
import type { ProviderTransport } from "./transport";

const REQUEST_TIMEOUT_MS = 60_000;
/** Leaves time to sign or post once the user approves at the last moment. */
const APPROVAL_REQUEST_TIMEOUT_MS = APPROVAL_MAX_MS + 60_000;

function timeoutFor(method: ProviderSurfaceMethod): number {
  return APPROVAL_GATED_METHODS.includes(method) ? APPROVAL_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}
export const WALLET_NAME = "Gleam";

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
 * The ArConnect-compatible wallet behind `window.arweaveWallet` and
 * `window.gleam` (walletName "Gleam"). Each method is one call through
 * the `ProviderTransport`, and every call:
 *
 * 1. Settles once. A `settled` flag drops a result that arrives after a
 *    timeout or an abort.
 * 2. Times out and rejects, so a hung or killed service worker can't hang
 *    the calling dApp forever. Methods that can open an approval window
 *    wait longer than the background's own approval timeout, so the dApp
 *    never sees a timeout for a request the user can still approve.
 * 3. Accepts an `AbortSignal` (`options.signal`) on every method that
 *    takes options. An abort only rejects the page-side promise. There is
 *    no cancel message, and it must never send a real method such as
 *    `disconnect`: the background would run it and revoke the dApp's grant.
 * 4. Tags `ArrayBuffer`/`Uint8Array` params and untags results, since
 *    neither survives every hop to the background intact.
 *
 * The transport is held in a `#private` field: this object is reachable
 * from page scripts, and they must not get a handle on the transport.
 */
export class GleamProvider {
  readonly walletName = WALLET_NAME;
  readonly walletVersion: string;
  readonly #transport: ProviderTransport;

  /** `signal` stops relaying pushed events; `installProvider`'s teardown uses it. */
  constructor(transport: ProviderTransport, walletVersion: string, signal?: AbortSignal) {
    this.#transport = transport;
    this.walletVersion = walletVersion;
    const unsubscribe = transport.onEvent((event, data) => {
      window.dispatchEvent(new CustomEvent(event, { detail: data }));
    });
    signal?.addEventListener("abort", unsubscribe, { once: true });
  }

  private call(method: ProviderSurfaceMethod, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) {
      return Promise.reject(new Error(`"${method}" was aborted before it was sent.`));
    }

    const timeoutMs = timeoutFor(method);
    const sent = new AbortController();

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        return true;
      };
      const giveUp = (error: Error): void => {
        if (!settle()) return;
        sent.abort();
        reject(error);
      };
      const timeoutId = setTimeout(() => giveUp(new Error(`"${method}" timed out after ${timeoutMs}ms.`)), timeoutMs);
      const onAbort = () => giveUp(new Error(`"${method}" was aborted.`));
      signal?.addEventListener("abort", onAbort, { once: true });

      let response: Promise<unknown>;
      try {
        response = Promise.resolve(this.#transport.request(method, encodeTaggedBinary(params), sent.signal));
      } catch (error) {
        response = Promise.reject(error);
      }
      response.then(
        (result) => {
          if (!settle()) return;
          // The timeout is already cleared, so a malformed result must reject here or the call never settles.
          try {
            resolve(decodeTaggedBinary(result));
          } catch (error) {
            reject(error);
          }
        },
        (error: unknown) => {
          if (settle()) reject(error);
        },
      );
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

  /** Every `options`-accepting method below pulls `signal` out of it (point 3) before forwarding the rest as params. */
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
