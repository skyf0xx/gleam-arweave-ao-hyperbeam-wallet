/** The per-key subscriber sets behind a `StoragePort.watch`. */
export class KeyWatchers {
  private readonly byKey = new Map<string, Set<(value: unknown) => void>>();

  watch<T>(key: string, cb: (value: T | null) => void): () => void {
    const listeners = this.byKey.get(key) ?? new Set();
    const listener = cb as (value: unknown) => void;
    listeners.add(listener);
    this.byKey.set(key, listeners);
    return () => void listeners.delete(listener);
  }

  /** The current subscribers of `key`; the caller decides how a failing one is handled. */
  of(key: string): Iterable<(value: unknown) => void> {
    return this.byKey.get(key) ?? [];
  }
}
