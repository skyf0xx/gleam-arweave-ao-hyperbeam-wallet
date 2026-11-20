import { isWatchWalletMethod, type WalletSummary } from "@gleam/core";
import { AccountAvatar, AddressDisplay, QrCode, WatchOnlyBadge } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { useAddressIdentity } from "../../../address-identity";
import { useT } from "../../../i18n";

/**
 * QR + full address + one-tap copy. See `QrCode`'s own doc comment for
 * the QR-encoding limitation carried into this screen.
 */
export interface ReceiveViewProps {
  wallet: WalletSummary;
  onBack: () => void;
}

export function ReceiveView({ wallet, onBack }: ReceiveViewProps) {
  const t = useT();
  const identity = useAddressIdentity();
  const { emphasisPick } = identity;
  const avatarSvg = identity.avatarSvg(wallet.address);
  const watchOnly = isWatchWalletMethod(wallet.method);
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("receive.title")} onBack={onBack} />

      <div className="flex flex-1 flex-col items-center gap-5 px-6 phone:px-5 pb-6 pt-7 phone:pt-4">
        <div className="flex items-center gap-2">
          <AccountAvatar svgMarkup={avatarSvg} label={t("receive.avatarLabel", { name: wallet.name })} size={24} />
          <span className="text-label">{wallet.name}</span>
          {watchOnly ? <WatchOnlyBadge /> : null}
        </div>

        <QrCode value={wallet.address} />

        {/* On paper, glass is laid from the address down to the foot of the screen; the QR stays on the paper. */}
        <div className="gleam-paper-glass-down flex flex-1 flex-col items-center gap-5 self-stretch paper:-mx-6 paper:-mb-6 paper:px-6 paper:pb-6 paper:pt-5 phone:paper:-mx-5 phone:paper:px-5">
          <div className="flex w-full flex-col gap-2">
            <span className="text-center text-label font-semibold text-muted">{watchOnly ? t("receive.watchedAddress") : t("receive.yourAddress")}</span>
            <AddressDisplay
              onGlass
              address={wallet.address}
              emphasisPick={emphasisPick}
              onCopy={() => void navigator.clipboard?.writeText(wallet.address)}
            />
          </div>

          <p className="max-w-[280px] text-center text-label leading-relaxed text-faint">
            {t("receive.warning")}
          </p>
        </div>
      </div>
    </div>
  );
}
