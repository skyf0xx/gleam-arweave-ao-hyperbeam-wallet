import { EmptyState as EmptyStatePrimitive } from "../../primitives/empty-state";

/**
 * The shared empty-state pattern — a single dry, understated line, never
 * a mascot, never the Irreversible-tier warning red.
 *
 * Thin wrapper around `primitives/empty-state`'s `EmptyState` (same
 * component, `message`-only prop shape kept for this directory's
 * existing call sites) rather than a second implementation of the same
 * markup.
 */
export interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return <EmptyStatePrimitive message={message} />;
}
