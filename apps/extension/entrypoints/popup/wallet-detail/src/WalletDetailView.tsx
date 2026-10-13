import { useMemo, useState } from "react";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { isHardwareWalletMethod, type JWKInterface, type RuntimePort, type WalletSummary } from "@gleam/core";
import { AccountAvatar } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { generateAccountAvatarSvg } from "../../main-screen/src/generateAccountAvatar";

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

function downloadKeyfile(contents: string, walletName: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${walletName.replace(/\s+/g, "-").toLowerCase()}-arweave-keyfile.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * `backupConfirmedAt` is set only after a download or copy actually
 * succeeds — a clipboard write can silently reject (unsupported context,
 * permission denied), and marking the backup confirmed anyway would leave
 * removal flows trusting a backup that was never made. An old stored
 * record with no value for the field counts as not backed up.
 */
export interface WalletDetailViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
  onRenamed: (name: string) => void;
  /** Called after `deleteWallet` succeeds — the caller re-derives its view from `getState` (removing the last wallet returns to onboarding on its own). */
  onRemoved: () => void;
}

type Step =
  | { kind: "detail" }
  | { kind: "export-password"; submitting: boolean; serverError?: string }
  | { kind: "export-reveal"; keyfileContents: string }
  | { kind: "remove-confirm"; removing: boolean; serverError?: string };

export function WalletDetailView({ runtime, wallet, onBack, onRenamed, onRemoved }: WalletDetailViewProps) {
  const avatarSvg = useMemo(() => generateAccountAvatarSvg(wallet.address), [wallet.address]);

  const [name, setName] = useState(wallet.name);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [backupConfirmedAt, setBackupConfirmedAt] = useState(wallet.backupConfirmedAt);
  const [step, setStep] = useState<Step>({ kind: "detail" });

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
      const jwk = await runtime.send<{ walletId: string; password: string }, JWKInterface>({
        type: "exportWallet",
        payload: { walletId: wallet.id, password },
      });
      setStep({ kind: "export-reveal", keyfileContents: JSON.stringify(jwk) });
    } catch (error) {
      setStep({
        kind: "export-password",
        submitting: false,
        serverError: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const confirmBackup = async () => {
    if (backupConfirmedAt !== null) return;
    await runtime.send<{ walletId: string }, void>({
      type: "confirmWalletBackup",
      payload: { walletId: wallet.id },
    });
    setBackupConfirmedAt(Date.now());
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

  if (step.kind === "export-reveal") {
    const keyfileContents = step.keyfileContents;
    return (
      <ExportRevealStep
        keyfileContents={keyfileContents}
        onBack={() => setStep({ kind: "detail" })}
        onDownload={() => {
          downloadKeyfile(keyfileContents, wallet.name);
          void confirmBackup();
        }}
        onCopy={async () => {
          if (!navigator.clipboard) {
            throw new Error("Clipboard isn't available. Download the keyfile instead.");
          }
          await navigator.clipboard.writeText(keyfileContents);
          await confirmBackup();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Wallet" onBack={onBack} />

      <div className="flex flex-1 flex-col gap-6 px-6 pb-6 pt-7">
        <div className="flex items-center gap-3">
          <AccountAvatar svgMarkup={avatarSvg} label={`${wallet.name} avatar`} size={44} className="rounded-2xl" />
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
                className={`text-caption ${backupConfirmedAt !== null ? "text-muted" : "font-semibold text-warning"}`}
              >
                {backupConfirmedAt !== null ? formatBackupDate(backupConfirmedAt) : "Not backed up yet"}
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
            Confirms it's you before revealing this wallet's keyfile.
          </p>
        </div>

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
          {submitting ? "Verifying…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}

function ExportRevealStep({
  keyfileContents,
  onBack,
  onDownload,
  onCopy,
}: {
  keyfileContents: string;
  onBack: () => void;
  onDownload: () => void;
  onCopy: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const handleCopy = async () => {
    setCopying(true);
    setCopyError(null);
    try {
      await onCopy();
      setCopied(true);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error));
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Your keyfile" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-5 px-6 py-6">
        <p className="text-body leading-relaxed text-muted">
          Store this somewhere safe. Anyone with this file and your password can access your
          wallet.
        </p>

        <div
          className="max-h-24 overflow-hidden rounded-md border border-line bg-mist p-3 font-mono text-caption leading-relaxed text-muted"
          style={{ wordBreak: "break-all" }}
        >
          {keyfileContents}
        </div>

        <Button type="button" onClick={onDownload}>
          Download keyfile
        </Button>
        <Button type="button" variant="secondary" disabled={copying} onClick={() => void handleCopy()}>
          {copied ? "Copied" : copying ? "Copying…" : "Copy to clipboard"}
        </Button>
        {copyError ? (
          <p role="alert" className="text-caption leading-relaxed text-warning">
            {copyError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
