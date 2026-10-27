import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { OptionRow, OptionSection } from "@gleam/ui/src/primitives/option-list.tsx";
import { usePlatform } from "../../../app-platform/context";
import { hasHardwareWallet } from "../../../app-platform/hardware";

/**
 * The ways to bring in a wallet the user already has, grouped by what
 * they need on hand. Shown after Welcome's "I already have a wallet", and
 * as part of `AddWalletStart`.
 */
export interface ExistingWalletOptionsProps {
  onImport: () => void;
  onConnectKeystone: () => void;
  onConnectLedger: () => void;
  onWatch: () => void;
}

export function ExistingWalletOptions({ onImport, onConnectKeystone, onConnectLedger, onWatch }: ExistingWalletOptionsProps) {
  const { capabilities } = usePlatform();
  const { ledger, keystone } = capabilities.hardwareWallets;
  return (
    <>
      <OptionSection title="From a file">
        <OptionRow title="Import a keyfile" description="A .json keyfile from another Arweave wallet" onClick={onImport} />
      </OptionSection>
      {hasHardwareWallet(capabilities) ? (
        <OptionSection title="Hardware wallet">
          {ledger ? <OptionRow title="Ledger" description="Connect over USB" onClick={onConnectLedger} /> : null}
          {keystone ? (
            <OptionRow title="Keystone" description="Scan its QR code with your camera" onClick={onConnectKeystone} />
          ) : null}
        </OptionSection>
      ) : null}
      <OptionSection title="Address only">
        <OptionRow title="Watch an address" description="See balances and activity, without sending or signing" onClick={onWatch} />
      </OptionSection>
    </>
  );
}

export interface ExistingWalletProps extends ExistingWalletOptionsProps {
  onBack: () => void;
}

export function ExistingWallet({ onBack, ...options }: ExistingWalletProps) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Use an existing wallet" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-6 px-6 phone:px-5 py-6">
        <ExistingWalletOptions {...options} />
      </div>
    </div>
  );
}
