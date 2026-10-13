import * as React from "react";
import { cn } from "../../primitives/cn";

/**
 * A full, untruncated, monospace address; the whole box copies on tap.
 * The first and last `EDGE_CHARS` are emphasised because that's what
 * people compare when checking an address against another screen.
 * Used on Receive and the send review screen — anywhere the full address
 * is required, never the truncated list form (`ActivityRow`'s
 * pre-truncated strings are a different, low-stakes context).
 *
 * `onCopy` is the caller's responsibility (clipboard write + any
 * telemetry); this component only renders the "Copied" affordance for
 * `copiedDurationMs` after each call.
 */
const EDGE_CHARS = 6;

export interface AddressDisplayProps {
  address: string;
  onCopy: () => void;
  copiedDurationMs?: number;
  className?: string;
}

export function AddressDisplay({
  address,
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

  const split = address.length > EDGE_CHARS * 2;
  const head = split ? address.slice(0, EDGE_CHARS) : address;
  const middle = split ? address.slice(EDGE_CHARS, -EDGE_CHARS) : "";
  const tail = split ? address.slice(-EDGE_CHARS) : "";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Address copied" : `Copy address ${address}`}
        className={cn(
          "w-full rounded-lg border bg-mist px-4 py-3 text-left font-mono text-label leading-relaxed transition-colors",
          copied ? "border-positive" : "border-line hover:border-faint",
        )}
        style={{ wordBreak: "break-all" }}
      >
        <span className="font-semibold text-foreground">{head}</span>
        <span className="text-muted">{middle}</span>
        <span className="font-semibold text-foreground">{tail}</span>
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
