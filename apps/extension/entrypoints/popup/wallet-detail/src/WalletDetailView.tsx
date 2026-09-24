import { useMemo, useState } from "react";
import type { JWKInterface, RuntimePort, WalletSummary } from "@gleam/core";
import { AccountAvatar } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { generateAccountAvatarSvg } from "../../main-screen/src/generateAccountAvatar";

const WALLET_METHOD_LABEL: Record<WalletSummary["method"], string> = {
  jwk: "JWK",
  ethereum: "ETH",
  ledger: "LEDGER",
};

function truncateAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function formatBackupDate(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Confirmed today";
  if (days === 1) return "Confirmed 1 day ago";
  return `Confirmed ${days} days ago`;
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
}

type Step =
  | { kind: "detail" }
  | { kind: "export-password"; submitting: boolean; serverError?: string }
  | { kind: "export-reveal"; keyfileContents: string };

export function WalletDetailView({ runtime, wallet, onBack, onRenamed }: WalletDetailViewProps) {
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
            <div className="flex items-center gap-1.5">
              <span className="truncate text-label font-semibold text-foreground">{wallet.name}</span>
              <span className="flex-shrink-0 rounded-md border border-line bg-mist px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                {WALLET_METHOD_LABEL[wallet.method]}
              </span>
            </div>
            <span className="truncate font-mono text-caption text-faint">{truncateAddress(wallet.address)}</span>
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

        <div className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-label font-semibold text-foreground">Keyfile backup</span>
              <span className="text-caption text-muted">
                {backupConfirmedAt !== null ? formatBackupDate(backupConfirmedAt) : "No backup on record"}
              </span>
            </div>
            <span
              className={`flex-shrink-0 text-caption font-semibold ${
                backupConfirmedAt !== null ? "text-positive" : "text-muted"
              }`}
            >
              {backupConfirmedAt !== null ? "Backed up" : "Not backed up"}
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={() => setStep({ kind: "export-password", submitting: false })}
        >
          Back up keyfile
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
