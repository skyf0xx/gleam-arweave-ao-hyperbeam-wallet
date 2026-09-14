/**
 * The primary Send/Receive action pair (wallet-main-screen.html's
 * `.actions`, tokens-activity.html's token-detail equivalent). Primary
 * (Send) is black-on-white per brand/guidelines.md's button rules,
 * secondary (Receive) is bordered white.
 */
export interface SendReceiveActionsProps {
  onSend: () => void;
  onReceive: () => void;
}

export function SendReceiveActions({ onSend, onReceive }: SendReceiveActionsProps) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onSend}
        className="flex flex-1 flex-col items-center gap-1.5 rounded-[10px] bg-[#111111] py-4 text-[13px] font-semibold text-white hover:brightness-[1.15]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Send
      </button>
      <button
        type="button"
        onClick={onReceive}
        className="flex flex-1 flex-col items-center gap-1.5 rounded-[10px] border border-[#e5e5e5] bg-white py-4 text-[13px] font-semibold text-[#111111] hover:border-[#111111]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M12 19l-6-6M12 19l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Receive
      </button>
    </div>
  );
}
