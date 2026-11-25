/**
 * Holds values by key for `ttlMs`. An expired entry stays until it is read
 * past or pushed out: once more than `max` are held, the one set longest
 * ago goes. `set` returns the value so a miss reads `get(k) ?? set(k, await load())`.
 */
export function keyedTtlCache<T>(ttlMs: number, nowMs: () => number, max = Infinity) {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  return {
    get(key: string): T | undefined {
      const hit = entries.get(key);
      return hit && nowMs() < hit.expiresAt ? hit.value : undefined;
    },
    set(key: string, value: T): T {
      entries.delete(key);
      entries.set(key, { value, expiresAt: nowMs() + ttlMs });
      if (entries.size > max) entries.delete(entries.keys().next().value!);
      return value;
    },
    clear: () => entries.clear(),
  };
}

/** Holds one value for `ttlMs`. */
export function ttlCache<T>(ttlMs: number, nowMs: () => number) {
  const keyed = keyedTtlCache<T>(ttlMs, nowMs, 1);
  return {
    get: (): T | undefined => keyed.get(""),
    set: (value: T): T => keyed.set("", value),
  };
}
