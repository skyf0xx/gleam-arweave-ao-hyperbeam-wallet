import * as React from "react";
import { cn } from "../../primitives/cn";
import { MemorableAddress } from "./MemorableAddress";
import { useUiLabels } from "../../labels";
import { CheckIcon, CopyIcon } from "../../primitives/copy-icons";

const HOLD_MS = 500;

/**
 * A full, untruncated address in `MemorableAddress`'s chunked form; the
 * whole box copies on tap or press-and-hold. Used on Receive, where the
 * user learns how their own address reads.
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
  /** Accessible names and hints; English unless the caller passes its own. */
  labels?: AddressDisplayLabels;
  className?: string;
}

export interface AddressDisplayLabels {
  copied: string;
  copy: (address: string) => string;
}

export function AddressDisplay({
  address,
  emphasisPick = null,
  onCopy,
  copiedDurationMs = 2000,
  labels: labelsProp,
  className,
}: AddressDisplayProps) {
  const contextLabels = useUiLabels();
  const labels = labelsProp ?? contextLabels.addressDisplay;
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const holdRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = React.useRef(false);

  React.useEffect(() => {
    return () => {
      if (holdRef.current) clearTimeout(holdRef.current);
    };
  }, []);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), copiedDurationMs);
  };

  const stopHold = () => {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = null;
  };
  const startHold = () => {
    heldRef.current = false;
    stopHold();
    holdRef.current = setTimeout(() => {
      heldRef.current = true;
      handleCopy();
    }, HOLD_MS);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        onClick={() => {
          // The release that ends a long press also clicks.
          if (heldRef.current) {
            heldRef.current = false;
            return;
          }
          handleCopy();
        }}
        onPointerDown={startHold}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        // Holding would otherwise select the text or open the OS menu.
        onContextMenu={(event) => event.preventDefault()}
        aria-label={copied ? labels.copied : labels.copy(address)}
        className="flex w-full select-none items-center justify-center gap-3 rounded-lg border border-line bg-foreground/[0.03] px-4 py-3 transition-colors [-webkit-touch-callout:none] hover:bg-foreground/[0.05] focus:outline-none focus-visible:border-foreground"
      >
        <MemorableAddress address={address} emphasisPick={emphasisPick} className="justify-center" />
        <span aria-hidden="true" className={cn("flex-shrink-0", copied ? "text-positive" : "text-faint")}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </span>
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? labels.copied : ""}
      </span>
    </div>
  );
}
