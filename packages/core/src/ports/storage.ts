/**
 * The host must provide a key/value storage primitive so `core` never
 * calls `wxt/utils/storage` (or `chrome.storage.*`) directly — that API
 * is keyed on extension storage areas, and calling it from `core` would
 * make the package non-portable.
 *
 * Implemented by `apps/extension/src/adapters/storage.ts`, over
 * `wxt/utils/storage`. `core` never imports that adapter — only this
 * interface.
 *
 * Which storage area (`local:` vs. `session:`) backs a given key is an
 * adapter-level wiring decision, not something this interface encodes —
 * it is shape-agnostic on purpose so the later layer can route
 * unlocked-session metadata to `chrome.storage.session` (memory-only,
 * cleared on browser close) while routing `Wallet` records to
 * `chrome.storage.local`, without either choice being visible here.
 *
 * Every value read back through `get`/`watch` is untrusted input: it may
 * have been written by an older schema version or partially corrupted.
 * Callers (not this port) are responsible for re-validating shape on
 * every load — this interface only moves bytes.
 */
export interface StoragePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  /**
   * Writes every entry in one atomic step: a reader or watcher sees all of
   * them or none. All keys must share one area prefix (`local:` or
   * `session:`); mixed areas reject before anything is written, since not
   * every platform can commit across both areas atomically. A `null` or
   * `undefined` value rejects too, before anything is written: `set` treats
   * those as a removal, which a single atomic write can't express, so use
   * `remove` to delete. An empty `entries` resolves without writing.
   */
  setMany(entries: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  /**
   * Subscribes to changes on `key`, invoking `cb` with the new value (or
   * `null` if removed) on every change. Returns an unsubscribe function.
   */
  watch<T>(key: string, cb: (value: T | null) => void): () => void;
}
