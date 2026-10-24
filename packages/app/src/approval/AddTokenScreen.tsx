import { useState } from "react";
import type { AddTokenApprovalPreview } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

/**
 * A dApp's `addToken` request. Adding only lists the token, so this stays
 * at Consequential tier: no risk notice, primary button. The ticker and
 * name come from the process's own spawn tags, which anyone can set, so the
 * full process id is always shown and the copy says who chose the name.
 */
export interface AddTokenScreenProps {
  origin: string;
  preview: AddTokenApprovalPreview;
  onReject: () => void;
  /** Rejects, with its message shown inline, if the token can't be added. */
  onAdd: () => Promise<void>;
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function AddTokenScreen({ origin, preview, onReject, onAdd }: AddTokenScreenProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const host = hostnameOf(origin);

  const handleAdd = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onAdd();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md border border-line bg-mist text-[10px] font-bold text-muted">
          {host.charAt(0).toUpperCase()}
        </div>
        <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground">{host}</span>
      </div>

      <div className="flex flex-1 flex-col gap-5 px-5 py-4.5">
        <div className="text-center text-body font-bold text-foreground">Add token</div>

        <div className="flex flex-col items-center gap-1 py-1 text-center">
          <span className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">
            {preview.ticker ?? "Unknown token"}
          </span>
          {preview.name !== null ? <span className="text-label text-muted">{preview.name}</span> : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">Process id</span>
          <span className="break-all font-mono text-caption leading-relaxed text-foreground">{preview.processId}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">To wallet</span>
          <span className="break-all font-mono text-caption leading-relaxed text-foreground">{preview.address}</span>
        </div>

        <p className="text-caption leading-snug text-muted">
          The name and ticker are set by whoever created the token. Adding it only shows its balance in your
          wallet.
        </p>

        {error ? (
          <div role="alert" className="text-caption leading-snug text-warning">
            {error}
          </div>
        ) : null}

        <div className="mt-auto flex gap-2.5 pt-1">
          <Button type="button" variant="secondary" onClick={onReject} className="flex-1">
            Reject
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitting}
            aria-busy={submitting}
            onClick={() => void handleAdd()}
            className="flex-1"
          >
            {submitting ? "Adding…" : "Add token"}
          </Button>
        </div>
      </div>
    </div>
  );
}
