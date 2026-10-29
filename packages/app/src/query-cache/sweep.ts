import type { QueryCachePort } from "../app-platform/types";

/** Runs a clear or remove, logging a failure rather than rejecting: a stale cache only costs a stale first paint. */
export function forgetQueryCache(task: Promise<void>): Promise<void> {
  return task.catch((error: unknown) => console.error("Couldn't clear the query cache.", error));
}

/** Removes every stored cache whose wallet isn't in `walletIds`, or all of them when there are none. */
export async function sweepQueryCache(port: QueryCachePort, walletIds: ReadonlySet<string>): Promise<void> {
  if (walletIds.size === 0) return forgetQueryCache(port.clear());
  try {
    const stale = (await port.keys()).filter((key) => !walletIds.has(key));
    await Promise.all(stale.map((key) => forgetQueryCache(port.remove(key))));
  } catch (error) {
    console.error("Couldn't sweep the query cache.", error);
  }
}
