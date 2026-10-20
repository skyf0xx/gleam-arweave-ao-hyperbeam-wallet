import * as React from "react";
import { cn } from "../../primitives/cn";
import { MemorableAddress } from "./MemorableAddress";

/**
 * A full, untruncated address in `MemorableAddress`'s chunked form; the
 * whole box copies on tap. Used on Receive, where the user learns how
 * their own address reads.
 *
 * `onCopy` is the caller's responsibility (clipboard write + any
 * telemetry); this component only renders the "Copied" affordance for
 * `copiedDurationMs` after each call.
 */
export interface AddressDisplayProps {
  address: string;
  /** The user's emphasis pick (`addressEmphasisPick`). */
  emphasisPick?: number | null;
  onCopy: () => void;
  copiedDurationMs?: number;
  className?: string;
}

export function AddressDisplay({
  address,
  emphasisPick = null,
  onCopy,
  copiedDurationMs = 2000,
  className,
}: AddressDisplayProps) {
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), copiedDurationMs);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Address copied" : `Copy address ${address}`}
        className={cn(
          "flex w-full justify-center rounded-lg border bg-mist px-4 py-3 transition-colors",
          copied ? "border-positive" : "border-line hover:border-faint",
        )}
      >
        <MemorableAddress address={address} emphasisPick={emphasisPick} className="justify-center" />
      </button>
      <span
        aria-live="polite"
        className="h-[14px] text-center text-caption font-semibold text-positive"
      >
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
