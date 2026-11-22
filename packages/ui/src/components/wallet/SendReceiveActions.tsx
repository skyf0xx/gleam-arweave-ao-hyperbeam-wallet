import { useUiLabels } from "../../labels";
import { Button } from "../../primitives/button";

/**
 * The primary Send/Receive action pair. Composes the shared `Button`
 * primitive (primary/secondary) rather than hand-rolling button markup.
 */
export interface SendReceiveActionsProps {
  onSend: () => void;
  onReceive: () => void;
  /** Disables Send, e.g. for a wallet that can't sign. */
  sendDisabled?: boolean;
  /** Puts each icon beside its label in a shorter button, to match the compact header. */
  compact?: boolean;
}

/**
 * Dark and silica make Send and Receive equal raised tiles (frost in silica), keeping the bright
 * primary fill for the actions that commit (Confirm, Approve, Unlock). A
 * disabled tile keeps half the fill and fades its icon, so it doesn't read as
 * pressable beside the enabled one.
 */
const LAYERED_TILE = "gleam-tile gleam-frost layered:rounded-xl layered:border-transparent layered:bg-mist layered:text-foreground layered:hover:bg-line layered:hover:opacity-100 layered:disabled:bg-mist/50 layered:disabled:text-faint layered:[&>svg]:text-muted layered:disabled:[&>svg]:text-faint";
const STACKED_CLASS = "h-14 flex-col gap-1 py-2 text-label phone:h-16 phone:gap-1.5 phone:[@media(max-height:700px)]:h-14";
const COMPACT_CLASS = "h-12 gap-2 text-label phone:h-14";

export function SendReceiveActions({ onSend, onReceive, sendDisabled = false, compact = false }: SendReceiveActionsProps) {
  const labels = useUiLabels();
  const className = `${compact ? COMPACT_CLASS : STACKED_CLASS} ${LAYERED_TILE}`;
  const iconSize = compact ? 18 : 20;
  return (
    <div className="flex gap-3">
      <Button
        type="button"
        onClick={onSend}
        disabled={sendDisabled}
        className={className}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {labels.send}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={onReceive}
        className={className}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M12 19l-6-6M12 19l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {labels.receive}
      </Button>
    </div>
  );
}
