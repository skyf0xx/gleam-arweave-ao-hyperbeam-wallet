import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { StepDots, AddressReveal } from "@gleam/ui/src/components/onboarding/index.ts";

/**
 * Create wallet — key generated / backup prompt. Backup is explicit and
 * skippable, never forced — both "Continue to wallet" and "I'll back this
 * up later" lead to the same `onContinue`, the only difference is whether
 * the user downloaded the keyfile first.
 */
export interface BackupProps {
  onBack: () => void;
  onDownload: () => void;
  canDownload: boolean;
  downloading: boolean;
  savedAs: string | null;
  downloadError: string | null;
  onContinue: () => void;
}

export function Backup({ onBack, onDownload, canDownload, downloading, savedAs, downloadError, onContinue }: BackupProps) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader
        title="Create a wallet"
        onBack={onBack}
        subtitle={<StepDots total={2} current={2} />}
      />
      <div className="flex flex-1 flex-col gap-5 px-6 py-6">
        <div className="flex justify-center pb-1 pt-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-mist text-foreground">
            <BackupGlyph />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">
            Your wallet is ready
          </h1>
          <p className="text-body leading-relaxed text-muted">
            No seed phrase to write down. Back up your keyfile instead, whenever you
            want.
          </p>
          <p className="text-body font-bold leading-relaxed text-foreground">
            Anyone with the file can access your wallet, so store it somewhere safe.
          </p>
        </div>

        <AddressReveal
          onDownload={onDownload}
          canDownload={canDownload}
          downloading={downloading}
          savedAs={savedAs}
          downloadError={downloadError}
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
