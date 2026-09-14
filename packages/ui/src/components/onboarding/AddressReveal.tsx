import * as React from "react";
import { cn } from "../../primitives/cn";
import { Button } from "../../primitives/button";

/**
 * The "your wallet is ready" keyfile card (onboarding.html's
 * `.keyfile-card` / `.keyfile-reveal`) — backup is explicit and skippable
 * (TODO.md 1.3: "never show the raw key on screen by default; require an
 * explicit reveal tap"). This component only renders what it's given and
 * emits the three actions; downloading/copying/deciding what "content" is
 * belongs to the caller (a view module, not this presentational package).
 */
export interface AddressRevealProps {
  keyfileContents: string;
  revealed: boolean;
  onReveal: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onSkip: () => void;
  onContinue: () => void;
  className?: string;
}

export function AddressReveal({
  keyfileContents,
  revealed,
  onReveal,
  onDownload,
  onCopy,
  onSkip,
  onContinue,
  className,
}: AddressRevealProps) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {!revealed ? (
        <div className="overflow-hidden rounded-[10px] border border-[#e5e5e5]">
          <div className="flex items-center gap-2.5 border-b border-[#e5e5e5] p-3">
            <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-[#111111] text-white">
              <FileIcon />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="text-[13px] font-semibold text-[#111111]">Wallet keyfile</div>
              <div className="text-[11px] text-[#737373]">
                JSON &middot; encrypted with your password
              </div>
            </div>
            <button
              type="button"
              aria-label="Download keyfile"
              onClick={onDownload}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] text-[#737373] hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              <DownloadIcon />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2.5 p-3">
            <span className="text-xs font-medium text-[#111111]">Show keyfile contents</span>
            <button
              type="button"
              onClick={onReveal}
              className="p-1 text-xs font-medium text-[#737373] hover:text-[#111111] hover:underline"
            >
              Reveal
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            className="max-h-24 overflow-hidden rounded-[9px] border border-[#e5e5e5] bg-[#f5f5f5] p-3 font-mono text-[11px] leading-relaxed text-[#737373]"
            style={{ wordBreak: "break-all" }}
          >
            {keyfileContents}
          </div>
          <div className="flex items-center justify-between gap-2.5">
            <span className="text-xs font-medium text-[#737373]">
              Full contents copied on download
            </span>
            <button
              type="button"
              onClick={onCopy}
              className="p-1 text-xs font-medium text-[#737373] hover:text-[#111111] hover:underline"
            >
              Copy
            </button>
          </div>
        </>
      )}

      <Button type="button" onClick={onContinue} className="w-full">
        Continue to wallet
      </Button>
      {!revealed ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onSkip}
            className="p-1 text-xs font-medium text-[#737373] hover:text-[#111111] hover:underline"
          >
            I&apos;ll back this up later
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12M12 15l-4-4M12 15l4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 19h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
