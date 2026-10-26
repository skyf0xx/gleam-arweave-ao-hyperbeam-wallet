import { useEffect, useRef, useState } from "react";
import type { Collectible } from "@gleam/core";
import { CollectibleThumbnail } from "@gleam/ui/src/components/wallet/index.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";

export interface CollectibleDetailViewProps {
  collectible: Collectible;
  onBack: () => void;
  /** The Send button only renders when this is provided. */
  onSend?: (collectible: Collectible) => void;
}

export function CollectibleDetailView({ collectible, onBack, onSend }: CollectibleDetailViewProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copyId = () => {
    void navigator.clipboard?.writeText(collectible.id);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Collectible" onBack={onBack} />

      <div className="flex flex-1 flex-col gap-5 px-6 phone:px-5 pb-6 phone:pb-0 pt-6">
        <CollectibleThumbnail name={collectible.name} imageUrl={collectible.imageUrl} className="mx-auto max-w-[280px]" />

        <div className="flex flex-col gap-0.5 text-center">
          <h2 className="break-words text-h3 font-semibold">{collectible.name}</h2>
          {collectible.collectionName ? <p className="text-label text-muted">{collectible.collectionName}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line pt-3.5 phone:border-t-0 phone:pt-0">
          <span className="text-label text-muted">Process ID</span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-label" title={collectible.id}>
              {truncateAddress(collectible.id, 6)}
            </span>
            <button
              type="button"
              onClick={copyId}
              aria-label={copied ? "Process ID copied" : "Copy process ID"}
              className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-mist ${copied ? "text-positive" : "text-muted hover:text-foreground"}`}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </span>
        </div>

        <a
          href={`https://lunar.arweave.net/#/explorer/${encodeURIComponent(collectible.id)}/data`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-label font-medium text-muted underline decoration-faint underline-offset-2 hover:text-foreground"
        >
          View on Lunar
        </a>

        {onSend ? (
          <ScreenFooter className="gap-0 pt-2">
            <Button onClick={() => onSend(collectible)}>Send</Button>
          </ScreenFooter>
        ) : null}
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
