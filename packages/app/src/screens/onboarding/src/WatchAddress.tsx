import { useState } from "react";
import { isValidArweaveAddress, type RuntimePort, type WalletSummary } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { StepForm, StepIntro } from "@gleam/ui/src/components/onboarding/index.ts";
import { usePlatform } from "../../../app-platform/context";
import { addressFromQr, QrScanError } from "../../../app-platform/qr-scanner";
import { QrScanIcon } from "../../send/src/SendView";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";

/**
 * Adds a watch-only wallet: an address Gleam shows balances and activity
 * for, with no key, so it never signs. It asks for no password, as a
 * hardware wallet doesn't.
 */
export interface WatchAddressProps {
  runtime: RuntimePort;
  onBack: () => void;
  onAdded: (wallet: WalletSummary) => void;
}

export function WatchAddress({ runtime, onBack, onAdded }: WatchAddressProps) {
  const t = useT();
  const { capabilities, qrScanner } = usePlatform();
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [addressError, setAddressError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function scan() {
    setScanning(true);
    setAddressError(undefined);
    try {
      const payload = await qrScanner.scan();
      if (payload === null) return;
      const scanned = addressFromQr(payload);
      setAddress(scanned);
      if (!isValidArweaveAddress(scanned)) setAddressError(t("onboarding.invalidAddress"));
    } catch (error) {
      setAddressError(
        error instanceof QrScanError && error.reason === "permission-denied"
          ? t("onboarding.cameraOff")
          : t("onboarding.scanFailed"),
      );
    } finally {
      setScanning(false);
    }
  }

  async function submit() {
    const trimmed = address.trim();
    if (!isValidArweaveAddress(trimmed)) {
      setAddressError(t("onboarding.invalidAddress"));
      return;
    }
    setSubmitting(true);
    setAddressError(undefined);
    try {
      onAdded(
        await runtime.send<{ address: string; name?: string }, WalletSummary>({
          type: "addWatchWallet",
          payload: { address: trimmed, name: name.trim() || undefined },
        }),
      );
    } catch (error) {
      setAddressError(errorText(error));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("onboarding.watchAddress")} onBack={onBack} busy={submitting} />
      <StepForm
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting) void submit();
        }}
      >
        <StepIntro title={t("onboarding.watchAddress")} body={t("onboarding.watchBody")} />

        <TextField
          label={t("onboarding.addressLabel")}
          placeholder={t("onboarding.addressPlaceholder")}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          value={address}
          disabled={submitting}
          className="font-mono text-label"
          onChange={(event) => {
            setAddress(event.target.value);
            setAddressError(undefined);
          }}
          errorMessage={addressError}
          hint={
            capabilities.qrScanner ? (
              <button
                type="button"
                aria-label={t("onboarding.scanQr")}
                disabled={scanning || submitting}
                onClick={() => void scan()}
                // 44px target without growing the label row.
                className="-my-3 -mr-3 flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground disabled:opacity-50"
              >
                <QrScanIcon />
              </button>
            ) : undefined
          }
        />

        <TextField
          label={t("onboarding.nameOptional")}
          placeholder={t("onboarding.watchedWalletPlaceholder")}
          value={name}
          disabled={submitting}
          onChange={(event) => setName(event.target.value)}
        />

        <ScreenFooter className="mt-8">
          <Button type="submit" disabled={submitting || address.trim().length === 0}>
            {submitting ? t("onboarding.adding") : t("onboarding.watchAddressButton")}
          </Button>
        </ScreenFooter>
      </StepForm>
    </div>
  );
}
