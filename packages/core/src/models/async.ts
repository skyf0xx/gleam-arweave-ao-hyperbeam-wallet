/**
 * Runs `load` on the first call and hands every later call the same
 * promise. A rejection isn't kept: the next call loads again.
 */
export function retryingOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () =>
    (cached ??= load().catch((error: unknown) => {
      cached = undefined;
      throw error;
    }));
}

/** A function that shares one run among callers that arrive while it is in flight. */
export interface SingleFlight<A extends unknown[], T> {
  (...args: A): Promise<T>;
  /** The run in flight, or null. */
  readonly inFlight: Promise<T> | null;
}

/**
 * Starts `run` only when none is in flight; a caller that arrives meanwhile
 * gets the running one's result, whatever arguments it passed.
 */
export function singleFlight<A extends unknown[], T>(run: (...args: A) => Promise<T>): SingleFlight<A, T> {
  let inFlight: Promise<T> | null = null;
  const call = (...args: A): Promise<T> =>
    (inFlight ??= run(...args).finally(() => {
      inFlight = null;
    }));
  return Object.defineProperty(call, "inFlight", { get: () => inFlight }) as SingleFlight<A, T>;
}
