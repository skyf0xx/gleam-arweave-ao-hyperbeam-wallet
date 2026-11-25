/**
 * `fn` over `items` with at most `limit` running at once, results in item
 * order. Once `signal` aborts, no further item starts and the rest stay
 * `undefined`.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        if (signal?.aborted) return;
        const index = next++;
        out[index] = await fn(items[index] as T);
      }
    }),
  );
  return out;
}
