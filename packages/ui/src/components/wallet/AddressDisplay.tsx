import * as React from "react";
import { cn } from "../../primitives/cn";

/**
 * A full, untruncated, monospace address with a one-tap copy affordance
 * (receive-screen.html's `.address-row`, brand/voice.md's "every
 * displayed address needs a visible, one-tap copy affordance" and
 * "truncated addresses in confirmation copy or examples" being a thing
 * we never do). Used on Receive and the send review screen — anywhere
 * RELEVANT RULES requires the full address, never the truncated list
 * form (`ActivityRow`'s pre-truncated strings are a different,
 * low-stakes context).
 *
 * `onCopy` is the caller's responsibility (clipboard write + any
 * telemetry); this component only renders the "Copied" affordance for
 * `copiedDurationMs` after each call, matching receive-screen.html's
 * copied state.
 */
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

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex w-full items-center gap-2 rounded-[10px] border border-[#e5e5e5] bg-[#f5f5f5] py-3 pl-4 pr-3">
        <span
          className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-[#111111]"
          style={{ wordBreak: "break-all" }}
        >
          {address}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Address copied" : "Copy address"}
          className={cn(
            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border bg-white",
            copied
              ? "border-[#16a34a] text-[#16a34a]"
              : "border-[#e5e5e5] text-[#737373] hover:border-[#a3a3a3] hover:text-[#111111]",
          )}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      <span
        aria-live="polite"
        className="h-[14px] text-center text-[11px] font-semibold text-[#16a34a]"
      >
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
