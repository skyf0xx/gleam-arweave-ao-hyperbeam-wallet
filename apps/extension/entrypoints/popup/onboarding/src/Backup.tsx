import { useState } from "react";
import { ScreenHeader, StepDots, AddressReveal } from "@gleam/ui/src/components/onboarding/index.ts";

/**
 * 1.3 Create wallet — key generated / backup prompt (onboarding.html).
 * Backup is explicit and skippable, never forced (RELEVANT RULES) — both
 * "Continue to wallet" and "I'll back this up later" lead to the same
 * `onContinue`, the only difference is whether the user revealed/
 * downloaded the keyfile first.
 */
export interface BackupProps {
  onBack: () => void;
  keyfileContents: string;
  onDownload: () => void;
  onCopy: () => void;
  onContinue: () => void;
}

export function Backup({ onBack, keyfileContents, onDownload, onCopy, onContinue }: BackupProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader
        title="Create a wallet"
        onBack={onBack}
        subtitle={<StepDots total={2} current={2} />}
      />
      <div className="flex flex-1 flex-col gap-5 px-6 py-6">
        {!revealed ? (
          <>
            <div className="flex justify-center pb-1 pt-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f5f5f5] text-[#111111]">
                <BackupGlyph />
              </div>
            </div>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <h1 className="text-lg font-semibold tracking-tight text-[#111111]">
                Your wallet is ready
              </h1>
              <p className="text-[13px] leading-relaxed text-[#737373]">
                No seed phrase to write down &mdash; back up your keyfile instead, whenever you
                want.
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-[#111111]">Your keyfile</h1>
            <p className="text-[13px] leading-relaxed text-[#737373]">
              Store this somewhere safe. Anyone with this file and your password can access your
              wallet.
            </p>
          </div>
        )}

        <AddressReveal
          keyfileContents={keyfileContents}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onDownload={onDownload}
          onCopy={onCopy}
          onSkip={onContinue}
          onContinue={onContinue}
          className="mt-auto"
        />
      </div>
    </div>
  );
}

function BackupGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12M12 15l-4-4M12 15l4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
