/**
 * The shared empty-state pattern (tokens-activity.html's `.empty-state` /
 * TODO.md 4.5) — the one screen category allowed brand personality's
 * "release valve": a single dry, understated line, a simple geometric
 * mark, never a mascot, never the Irreversible-tier warning red.
 */
export interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 py-12 text-center">
      <div role="presentation" className="h-[3px] w-8 rounded-sm bg-[#e5e5e5]" />
      <p className="max-w-[260px] text-[13px] text-[#737373]">{message}</p>
    </div>
  );
}
