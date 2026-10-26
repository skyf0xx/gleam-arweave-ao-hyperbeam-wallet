import { cn } from "../../primitives/cn";
import { Button } from "../../primitives/button";

/**
 * The "your wallet is ready" keyfile card. Backup is explicit and
 * skippable. The card never holds the key itself: the caller saves the
 * file and reports back `downloading`, `savedAs` or `downloadError`.
 */
export interface AddressRevealProps {
  onDownload: () => void;
  /** False once this screen can no longer start a download. */
  canDownload?: boolean;
  downloading?: boolean;
  /** The saved file's name, once the download has finished. */
  savedAs?: string | null;
  downloadError?: string | null;
  onSkip: () => void;
  onContinue: () => void;
  className?: string;
}

export function AddressReveal({
  onDownload,
  canDownload = true,
  downloading = false,
  savedAs = null,
  downloadError = null,
  onSkip,
  onContinue,
  className,
}: AddressRevealProps) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5 rounded-lg border border-line p-3">
          <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <FileIcon />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="text-label font-semibold text-foreground">Wallet keyfile</div>
            <div className="truncate text-caption text-muted">
              {savedAs ? `Saved as ${savedAs}` : downloading ? "Saving…" : <>JSON &middot; standard Arweave keyfile</>}
            </div>
          </div>
          <button
            type="button"
            aria-label="Save keyfile"
            onClick={onDownload}
            disabled={downloading || !canDownload}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-mist hover:text-foreground disabled:opacity-50 phone:hit-target"
          >
            <DownloadIcon />
          </button>
        </div>
        {downloadError ? (
          <p role="alert" className="text-caption leading-relaxed text-warning">
            {downloadError}
          </p>
        ) : null}
      </div>

      <Button type="button" onClick={onContinue}>
        Continue to wallet
      </Button>
      {!savedAs ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onSkip}
            className="p-1 text-label font-medium text-muted hover:text-foreground hover:underline phone:flex phone:min-h-11 phone:items-center phone:px-4"
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
