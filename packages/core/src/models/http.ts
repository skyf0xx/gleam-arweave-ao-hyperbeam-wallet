export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** A fetch that gives every request its own timeout, so one hung host can't hold a scan past its budget. */
export function withRequestTimeout(fetchImpl: typeof fetch, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): typeof fetch {
  return ((input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })) as typeof fetch;
}

/** A 2xx status. */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}
