import type { WalletSummary } from "@gleam/core";
import { AddressDisplay, QrCode } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";

/**
 * Receive screen (receive-screen.html / TODO.md 3.1) — QR + full address
 * + one-tap copy (RELEVANT RULES: "Receive screen shows the full address
 * with a QR code and a one-tap copy affordance"). See `QrCode`'s own doc
 * comment for the QR-encoding limitation carried into this screen.
 */
export interface ReceiveViewProps {
  wallet: WalletSummary;
  onBack: () => void;
}

export function ReceiveView({ wallet, onBack }: ReceiveViewProps) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Receive" onBack={onBack} />

      <div className="flex flex-1 flex-col items-center gap-5 px-6 pb-6 pt-7">
        <div className="flex items-center gap-2">
          <span className="text-label">{wallet.name}</span>
        </div>

        <QrCode value={wallet.address} />

        <div className="flex w-full flex-col gap-2">
          <span className="text-center text-label font-semibold text-muted">Your address</span>
          <AddressDisplay
            address={wallet.address}
            onCopy={() => void navigator.clipboard?.writeText(wallet.address)}
          />
        </div>

        <p className="max-w-[280px] text-center text-label leading-relaxed text-faint">
          Only send AO and Arweave-compatible assets to this address. Sending anything else may result in
          permanent loss.
        </p>
      </div>
    </div>
  );
}
