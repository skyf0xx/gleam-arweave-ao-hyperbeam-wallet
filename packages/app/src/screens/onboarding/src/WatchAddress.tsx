import { useState } from "react";
import { isValidArweaveAddress, type RuntimePort, type WalletSummary } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { usePlatform } from "../../../app-platform/context";
import { addressFromQr, QrScanError } from "../../../app-platform/qr-scanner";
import { QrScanIcon } from "../../send/src/SendView";

const INVALID_ADDRESS = "That isn't an Arweave address. An address is 43 letters, numbers, - and _.";

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
      if (!isValidArweaveAddress(scanned)) setAddressError(INVALID_ADDRESS);
    } catch (error) {
      setAddressError(
        error instanceof QrScanError && error.reason === "permission-denied"
          ? "Camera access is off for Gleam. Turn it on in Settings to scan."
          : "Couldn't scan. Try again or paste the address.",
      );
    } finally {
      setScanning(false);
    }
  }

  async function submit() {
    const trimmed = address.trim();
    if (!isValidArweaveAddress(trimmed)) {
      setAddressError(INVALID_ADDRESS);
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
      setAddressError(error instanceof Error ? error.message : String(error));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Watch an address" onBack={onBack} busy={submitting} />
      <form
        className="flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6 phone:pb-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting) void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">Watch an address</h1>
          <p className="text-body leading-relaxed text-muted">
            See its balances and activity. Gleam has no key for it, so it can&apos;t send or sign.
          </p>
        </div>

        <TextField
          label="Address"
          placeholder="Paste an address"
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
                aria-label="Scan QR code"
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
          label="Name (optional)"
          placeholder="Watched wallet"
          value={name}
          disabled={submitting}
          onChange={(event) => setName(event.target.value)}
        />

        <ScreenFooter className="mt-8">
          <Button type="submit" disabled={submitting || address.trim().length === 0}>
            {submitting ? "Adding…" : "Watch address"}
          </Button>
        </ScreenFooter>
      </form>
    </div>
  );
}
