import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { OptionRow, OptionSection } from "@gleam/ui/src/primitives/option-list.tsx";
import { ExistingWalletOptions } from "./ExistingWallet";

/**
 * Start of the add-wallet flow from the wallet switcher. Whoever lands
 * here already uses Gleam and chose to add a wallet, so every way in is
 * shown at once, grouped, without Welcome's new-or-existing step or its
 * brand hero.
 */
export interface AddWalletStartProps {
  onBack: () => void;
  onCreate: () => void;
  onImport: () => void;
  onConnectKeystone: () => void;
  onConnectLedger: () => void;
}

export function AddWalletStart({ onBack, onCreate, ...existing }: AddWalletStartProps) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Add wallet" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-6 px-6 phone:px-5 py-6">
        <h1 className="text-h3 font-semibold tracking-tight text-foreground">Add a wallet</h1>
        <OptionSection title="New">
          <OptionRow
            title="Create a wallet"
            description="A new address, protected by your Gleam password"
            onClick={onCreate}
          />
        </OptionSection>
        <ExistingWalletOptions {...existing} />
      </div>
    </div>
  );
}
