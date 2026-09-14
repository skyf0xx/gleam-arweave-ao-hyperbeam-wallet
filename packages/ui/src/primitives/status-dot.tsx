import { cn } from "./cn";

/**
 * The small dot + label network/connection-status indicator (shared.css
 * `.network-dot`/`.network-label`, wallet-main-screen.html's
 * "arweave.net" footer status — network-peers.html's per-peer
 * enable state reuses the same shape). Uses the plain semantic
 * `positive`/`warning`/`muted` tones, never a beam color — status is not
 * an identity moment.
 */
export interface StatusDotProps {
  label: string;
  tone?: "positive" | "warning" | "muted";
  className?: string;
}

const toneClass: Record<NonNullable<StatusDotProps["tone"]>, string> = {
  positive: "bg-positive",
  warning: "bg-warning",
  muted: "bg-faint",
};

export function StatusDot({ label, tone = "positive", className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", toneClass[tone])} />
      <span className="text-caption text-faint">{label}</span>
    </span>
  );
}
