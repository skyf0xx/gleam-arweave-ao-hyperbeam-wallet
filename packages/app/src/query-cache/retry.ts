import type { Query } from "@tanstack/react-query";

/** With no retry button on the home screen, a failed read asks again on its own this often. */
export const FAILED_READ_RETRY_MS = 30_000;

/**
 * How long a home read counts as fresh. Coming back to the home screen from
 * Send or a detail screen shows what it has instead of reading it all again;
 * a send invalidates what it changes.
 */
export const HOME_READ_STALE_MS = 30_000;

export function retryWhileFailed(query: Pick<Query, "state">): number | false {
  return query.state.status === "error" ? FAILED_READ_RETRY_MS : false;
}
