import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

/**
 * Start of the add-wallet flow from the wallet switcher. Same two choices
 * as `Welcome`, without its brand hero, which belongs to first run only.
 */
export interface AddWalletStartProps {
  onBack: () => void;
  onCreate: () => void;
  onImport: () => void;
}

export function AddWalletStart({ onBack, onCreate, onImport }: AddWalletStartProps) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Add wallet" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-5 px-6 py-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">Add a wallet</h1>
          <p className="text-body leading-relaxed text-muted">
            Create a new wallet or import one from its keyfile. It uses the same password as your
            other wallets.
          </p>
        </div>
        <div className="mt-auto flex w-full flex-col gap-2.5">
          <Button type="button" onClick={onCreate}>
            Create a wallet
          </Button>
          <Button type="button" variant="secondary" onClick={onImport}>
            Import a wallet
          </Button>
        </div>
      </div>
    </div>
  );
}
