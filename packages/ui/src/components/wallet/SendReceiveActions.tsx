import { Button } from "../../primitives/button";

/**
 * The primary Send/Receive action pair. Composes the shared `Button`
 * primitive (primary/secondary) rather than hand-rolling button markup.
 */
export interface SendReceiveActionsProps {
  onSend: () => void;
  onReceive: () => void;
}

export function SendReceiveActions({ onSend, onReceive }: SendReceiveActionsProps) {
  return (
    <div className="flex gap-3">
      <Button type="button" onClick={onSend} className="h-16 flex-col gap-1.5 py-2 text-label">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Send
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={onReceive}
        className="h-16 flex-col gap-1.5 py-2 text-label"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M12 19l-6-6M12 19l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Receive
      </Button>
    </div>
  );
}
