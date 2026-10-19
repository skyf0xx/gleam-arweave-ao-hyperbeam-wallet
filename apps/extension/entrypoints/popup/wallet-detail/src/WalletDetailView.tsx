import { useMemo, useState } from "react";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { isHardwareWalletMethod, type RuntimePort, type WalletSummary } from "@gleam/core";
import {
  downloadKeyfile,
  keyfileDownloadError,
  requestDownloadsPermission,
  type RequestDownloadsPermission,
} from "@/src/keyfile/download";
import { AccountAvatar } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { generateAccountAvatarSvg } from "@/src/account-avatar";

// JWK is what nearly every wallet is, so only the other methods get a label.
const WALLET_METHOD_LABEL: Record<WalletSummary["method"], string | null> = {
  jwk: null,
  ethereum: "Ethereum",
  ledger: "Ledger",
  keystone: "Keystone",
};

function formatBackupDate(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Backed up today";
  if (days === 1) return "Backed up 1 day ago";
  return `Backed up ${days} days ago`;
}

/**
 * `backupConfirmedAt` is set only after the background reports the
 * keyfile download finished. A cancelled or failed download leaves it
 * unset, so removal flows never trust a backup that was never made. An
 * old stored record with no value for the field counts as not backed up.
 */
export interface WalletDetailViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
  onRenamed: (name: string) => void;
  /** Called after `deleteWallet` succeeds — the caller re-derives its view from `getState` (removing the last wallet returns to onboarding on its own). */
  onRemoved: () => void;
  /** Asks for the optional `downloads` permission from the Download click. */
  requestDownloadPermission?: RequestDownloadsPermission;
}

type Step =
  | { kind: "detail" }
  | { kind: "export-password"; submitting: boolean; serverError?: string }
  | { kind: "remove-confirm"; removing: boolean; serverError?: string };

export function WalletDetailView({
  runtime,
  wallet,
  onBack,
  onRenamed,
  onRemoved,
  requestDownloadPermission = requestDownloadsPermission,
}: WalletDetailViewProps) {
  const avatarSvg = useMemo(() => generateAccountAvatarSvg(wallet.address), [wallet.address]);

  const [name, setName] = useState(wallet.name);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [backupConfirmedAt, setBackupConfirmedAt] = useState(wallet.backupConfirmedAt);
  const [step, setStep] = useState<Step>({ kind: "detail" });
  const [savedAs, setSavedAs] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameChanged = trimmedName.length > 0 && trimmedName !== wallet.name;

  const handleRename = async () => {
    if (!nameChanged || savingName) return;
    setSavingName(true);
    setNameError(null);
    try {
      await runtime.send<{ walletId: string; name: string }, void>({
        type: "renameWallet",
        payload: { walletId: wallet.id, name: trimmedName },
      });
      onRenamed(trimmedName);
    } catch (error) {
      setNameError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingName(false);
    }
  };

  const handleExportPassword = async (password: string) => {
    setStep({ kind: "export-password", submitting: true });
    try {
      const result = await downloadKeyfile(runtime, { walletId: wallet.id, password }, requestDownloadPermission);
      if (!result.ok) {
        setStep({ kind: "export-password", submitting: false, serverError: keyfileDownloadError(result) ?? undefined });
        return;
      }
      // The background has already recorded the backup.
      setSavedAs(result.filename);
      setBackupConfirmedAt((current) => current ?? Date.now());
      setStep({ kind: "detail" });
    } catch (error) {
      setStep({
        kind: "export-password",
        submitting: false,
        serverError: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleRemove = async () => {
    setStep({ kind: "remove-confirm", removing: true });
    try {
      await runtime.send<{ walletId: string }, void>({
        type: "deleteWallet",
        payload: { walletId: wallet.id },
      });
      onRemoved();
    } catch (error) {
      setStep({
        kind: "remove-confirm",
        removing: false,
        serverError: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const hardware = isHardwareWalletMethod(wallet.method);
  const methodLabel = WALLET_METHOD_LABEL[wallet.method];

  if (step.kind === "remove-confirm") {
    return (
      <RemoveConfirmStep
        walletName={wallet.name}
        hardware={hardware}
        backedUp={backupConfirmedAt !== null}
        onBack={() => setStep({ kind: "detail" })}
        onConfirm={() => void handleRemove()}
        removing={step.removing}
        serverError={step.serverError}
      />
    );
  }

  if (step.kind === "export-password") {
    return (
      <ExportPasswordStep
        onBack={() => setStep({ kind: "detail" })}
        onSubmit={(password) => void handleExportPassword(password)}
        submitting={step.submitting}
        serverError={step.serverError}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Wallet" onBack={onBack} />

      <div className="flex flex-1 flex-col gap-6 px-6 pb-6 pt-7">
        <div className="flex items-center gap-3">
          <AccountAvatar svgMarkup={avatarSvg} label={`${wallet.name} avatar`} size={44} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-label font-semibold text-foreground">{wallet.name}</span>
            <span className="truncate text-caption text-faint">
              <span className="font-mono">{truncateAddress(wallet.address, 8, 6)}</span>
              {methodLabel ? <> · {methodLabel}</> : null}
            </span>
          </div>
        </div>

        <TextField
          label="Name"
          value={name}
          disabled={savingName}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          onBlur={() => void handleRename()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          errorMessage={nameError ?? undefined}
        />

        {hardware ? null : (
          <button
            type="button"
            onClick={() => setStep({ kind: "export-password", submitting: false })}
            aria-describedby="keyfile-backup-status"
            className="flex w-full items-center gap-2.5 rounded-lg border border-line px-3.5 py-3 text-left hover:bg-mist"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-label font-semibold text-foreground">Back up keyfile</span>
              <span
                id="keyfile-backup-status"
                className={`truncate text-caption ${backupConfirmedAt !== null || savedAs ? "text-muted" : "font-semibold text-warning"}`}
              >
                {savedAs
                  ? `Saved as ${savedAs}`
                  : backupConfirmedAt !== null
                    ? formatBackupDate(backupConfirmedAt)
                    : "Not backed up yet"}
              </span>
            </span>
            <ChevronIcon />
          </button>
        )}

        {/* The solid destructive button is for the confirm step; this only opens it. */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep({ kind: "remove-confirm", removing: false })}
          className="mt-auto text-warning hover:text-warning"
        >
          Remove wallet
        </Button>
      </div>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="flex-shrink-0 text-faint">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RemoveConfirmStep({
  walletName,
  hardware,
  backedUp,
  onBack,
  onConfirm,
  removing,
  serverError,
}: {
  walletName: string;
  hardware: boolean;
  backedUp: boolean;
  onBack: () => void;
  onConfirm: () => void;
  removing: boolean;
  serverError?: string;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Remove wallet" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-5 px-6 py-6">
        <p className="text-body leading-relaxed text-muted">
          This removes <span className="font-semibold text-foreground">{walletName}</span> from
          this browser.
        </p>

        {hardware ? (
          <p className="text-body leading-relaxed text-muted">
            The key stays on your device, so you can add this wallet again later.
          </p>
        ) : !backedUp ? (
          <RiskNotice>
            You haven&apos;t backed up this wallet&apos;s keyfile. Once removed, there&apos;s no
            way to recover it and access is lost permanently.
          </RiskNotice>
        ) : (
          <p className="text-body leading-relaxed text-muted">
            You backed up this wallet&apos;s keyfile, so you can re-import it later.
          </p>
        )}

        {serverError ? (
          <p role="alert" className="text-caption leading-relaxed text-warning">
            {serverError}
          </p>
        ) : null}

        <Button type="button" variant="destructive" disabled={removing} onClick={onConfirm} className="mt-8">
          {removing ? "Removing…" : "Yes, remove wallet"}
        </Button>
      </div>
    </div>
  );
}

function ExportPasswordStep({
  onBack,
  onSubmit,
  submitting,
  serverError,
}: {
  onBack: () => void;
  onSubmit: (password: string) => void;
  submitting: boolean;
  serverError?: string;
}) {
  const [password, setPassword] = useState("");
  const [capsLockOn, setCapsLockOn] = useState(false);

  const [clearedFor, setClearedFor] = useState<string | undefined>(undefined);
  if (submitting && clearedFor !== undefined) setClearedFor(undefined);
  if (!submitting && serverError && serverError !== clearedFor) {
    setClearedFor(serverError);
    setPassword("");
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Back up keyfile" onBack={onBack} />
      <form
        className="flex flex-1 flex-col gap-5 px-6 py-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && password.length > 0) onSubmit(password);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">Enter your password</h1>
          <p className="text-body leading-relaxed text-muted">
            Confirms it's you, then saves this wallet's keyfile to your downloads.
          </p>
        </div>

        <RiskNotice>
          The keyfile isn&apos;t password-protected. Anyone who gets it controls this wallet.
          Keep it offline, and never share or upload it.
        </RiskNotice>

        <PasswordField
          label="Password"
          placeholder="Enter your password"
          autoFocus
          autoComplete="current-password"
          value={password}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
          onKeyUp={(event) => setCapsLockOn(event.getModifierState?.("CapsLock") ?? false)}
          capsLockOn={capsLockOn}
          errorMessage={serverError}
        />

        <Button type="submit" disabled={submitting || password.length === 0} className="mt-8">
          {submitting ? "Saving…" : "Download keyfile"}
        </Button>
      </form>
    </div>
  );
}
