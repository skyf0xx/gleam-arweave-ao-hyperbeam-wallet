/**
 * Marks a watch-only wallet: an address Gleam follows with no key, which
 * may not be the user's own.
 */
export function WatchOnlyBadge() {
  return (
    <span className="flex-shrink-0 rounded-full bg-mist px-2 py-0.5 text-caption font-medium text-muted">Watch only</span>
  );
}
