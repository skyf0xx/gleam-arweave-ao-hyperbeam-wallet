import { useState } from "react";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import {
  downloadKeyfile,
  keyfileDownloadError,
  requestDownloadsPermission,
  type RequestDownloadsPermission,
} from "@/src/keyfile/download";
import { Welcome } from "./Welcome";
import { CreatePassword } from "./CreatePassword";
import { Backup } from "./Backup";
import { Import } from "./Import";
import { AddWalletStart } from "./AddWalletStart";
import { ExistingWallet } from "./ExistingWallet";
import { openKeystoneConnect } from "@/src/hardware/keystone/open-connect";
import { openLedgerConnect } from "@/src/hardware/ledger/open-connect";
import { VaultPassword } from "./VaultPassword";
import { ClaimStep, type ClaimPhase } from "./ClaimStep";
import { FoundingRevealScreen } from "./FoundingReveal";

/**
 * Onboarding view module (`entrypoints/popup/onboarding/`) — a folder, not
 * a registered WXT entrypoint; the popup is one entrypoint with a
 * validated view-name string, and `App.tsx` imports `OnboardingView` and
 * mounts it when its view-switch selects `"onboarding"`.
 *
 * Internal step state only — no router, even one level down inside a
 * single view.
 */
type Step =
  | { kind: "welcome" }
  | { kind: "existing" }
  | { kind: "create-password" }
  // The password is kept only until the first download attempt resolves,
  // so the background can decrypt the keyfile when the user saves it.
  | { kind: "backup"; password: string | null; wallet: WalletSummary }
  | { kind: "import" }
  | { kind: "import-password"; jwk: unknown }
  | { kind: "claim"; wallet: WalletSummary }
  | { kind: "reveal"; wallet: WalletSummary; inviteCode: string };

export interface OnboardingViewProps {
  runtime: RuntimePort;
  onComplete: () => void;
  /**
   * `"add-wallet"` adds a wallet to an existing vault: it starts from the
   * wallet switcher instead of the welcome screen and asks for the current
   * vault password instead of setting one.
   */
  mode?: "first-run" | "add-wallet";
  /** Leaves the add-wallet flow from its first screen. */
  onCancel?: () => void;
  /**
   * Ends the flow on the Gleam Points claim step (and, for `founding`, the
   * founding reveal) before `onComplete`. Without it the flow ends at
   * backup or import.
   */
  claim?: ClaimPhase;
  /** Opens the Keystone connect page. Defaults to a new browser tab. */
  onConnectKeystone?: () => void;
  /** Opens the Ledger connect page. Defaults to a new browser tab. */
  onConnectLedger?: () => void;
  /** Asks for the optional `downloads` permission from the Download click. */
  requestDownloadPermission?: RequestDownloadsPermission;
}

const DEFAULT_WALLET_NAMES = [
  "Alexandrite",
  "Amber",
  "Amethyst",
  "Aquamarine",
  "Aurora",
  "Beam",
  "Bismuth",
  "Blue Diamond",
  "Crystal",
  "Ember",
  "Flint",
  "Fluorite",
  "Glint",
  "Glow",
  "Jade",
  "Jasper",
  "Lapis Lazuli",
  "Lumen",
  "Mega Pearl",
  "Nephrite",
  "Opal",
  "Peridot",
  "Pearl",
  "Pink Diamond",
  "Prism",
  "Quartz",
  "Rainbow Quartz",
  "Rose Quartz",
  "Ruby",
  "Sapphire",
  "Sardonyx",
  "Shimmer",
  "Smoky Quartz",
  "Spark",
  "Sugilite",
  "Topaz",
  "White Diamond",
  "Yellow Diamond",
];

function randomDefaultWalletName(): string {
  return DEFAULT_WALLET_NAMES[Math.floor(Math.random() * DEFAULT_WALLET_NAMES.length)]!;
}

export function OnboardingView({ runtime, onComplete, mode = "first-run", onCancel, claim, onConnectKeystone = () => void openKeystoneConnect(), onConnectLedger = () => void openLedgerConnect(), requestDownloadPermission = requestDownloadsPermission }: OnboardingViewProps) {
  const addingWallet = mode === "add-wallet";
  const [step, setStep] = useState<Step>({ kind: "welcome" });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [backup, setBackup] = useState<{ downloading: boolean; savedAs: string | null; error: string | null }>({
    downloading: false,
    savedAs: null,
    error: null,
  });

  const finish = (wallet: WalletSummary) => {
    if (claim) setStep({ kind: "claim", wallet });
    else onComplete();
  };

  // Recorded as soon as the wallet exists, so closing the popup anywhere
  // after this (backup, a link on the claim step) still brings the claim
  // step back on the home screen.
  const markClaimPending = async (wallet: WalletSummary) => {
    if (!claim) return;
    await runtime
      .send<{ walletId: string; pending: boolean }, void>({
        type: "setPointsClaimPending",
        payload: { walletId: wallet.id, pending: true },
      })
      .catch(() => {});
  };

  const handleCreatePassword = async (password: string) => {
    setSubmitting(true);
    setServerError(undefined);
    try {
      const summary = await runtime.send<{ name: string; password: string }, WalletSummary>({
        type: "createWallet",
        payload: { name: randomDefaultWalletName(), password },
      });
      await markClaimPending(summary);
      setStep({ kind: "backup", password, wallet: summary });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadKeyfile = async (wallet: WalletSummary, password: string) => {
    setBackup((current) => ({ ...current, downloading: true, error: null }));
    let result: Awaited<ReturnType<typeof downloadKeyfile>> | null = null;
    let error: string | null = null;
    try {
      result = await downloadKeyfile(runtime, { walletId: wallet.id, password }, requestDownloadPermission);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    if (result?.ok) {
      setStep((current) => (current.kind === "backup" ? { ...current, password: null } : current));
      setBackup({ downloading: false, savedAs: result.filename, error: null });
      return;
    }
    // A closed save dialog or a declined permission is worth retrying here,
    // so the password is kept until a save succeeds or onboarding moves on.
    const reason = result ? keyfileDownloadError(result) : error;
    setBackup({
      downloading: false,
      savedAs: null,
      error: `${reason ?? "The keyfile couldn't be saved."} Try again, or back it up later from this wallet's settings.`,
    });
  };

  const handleImportPassword = async (jwk: unknown, password: string) => {
    setSubmitting(true);
    setServerError(undefined);
    try {
      const summary = await runtime.send<{ jwk: unknown; name: string; password: string }, WalletSummary>({
        type: "importWallet",
        payload: { jwk, name: randomDefaultWalletName(), password },
      });
      await markClaimPending(summary);
      finish(summary);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  switch (step.kind) {
    case "welcome":
      if (addingWallet) {
        return (
          <AddWalletStart
            onBack={() => onCancel?.()}
            onCreate={() => setStep({ kind: "create-password" })}
            onImport={() => setStep({ kind: "import" })}
            onConnectKeystone={onConnectKeystone}
            onConnectLedger={onConnectLedger}
          />
        );
      }
      return (
        <Welcome
          onCreate={() => setStep({ kind: "create-password" })}
          onExisting={() => setStep({ kind: "existing" })}
        />
      );

    case "existing":
      return (
        <ExistingWallet
          onBack={() => setStep({ kind: "welcome" })}
          onImport={() => setStep({ kind: "import" })}
          onConnectKeystone={onConnectKeystone}
          onConnectLedger={onConnectLedger}
        />
      );

    case "create-password":
      if (addingWallet) {
        return (
          <VaultPassword
            title="Create a wallet"
            onBack={() => setStep({ kind: "welcome" })}
            onSubmit={(password) => void handleCreatePassword(password)}
            submitting={submitting}
            serverError={serverError}
          />
        );
      }
      return (
        <CreatePassword
          onBack={() => setStep({ kind: "welcome" })}
          onSubmit={handleCreatePassword}
          submitting={submitting}
          serverError={serverError}
        />
      );

    case "backup":
      return (
        <Backup
          // The wallet already exists by this step, so going back to the
          // start would only offer to create another one. Back finishes
          // like Continue does, so the claim step still shows.
          onBack={() => finish(step.wallet)}
          onDownload={() => {
            if (step.password !== null) void handleDownloadKeyfile(step.wallet, step.password);
          }}
          canDownload={step.password !== null}
          downloading={backup.downloading}
          savedAs={backup.savedAs}
          downloadError={backup.error}
          onContinue={() => finish(step.wallet)}
        />
      );

    case "import":
      return (
        <Import
          // Add-wallet mode lists the keyfile option on its first screen;
          // first run reaches it through "I already have a wallet".
          onBack={() => setStep({ kind: addingWallet ? "welcome" : "existing" })}
          onValidJWK={(jwk) => setStep({ kind: "import-password", jwk })}
        />
      );

    case "import-password":
      if (addingWallet) {
        return (
          <VaultPassword
            title="Import a wallet"
            onBack={() => setStep({ kind: "import" })}
            onSubmit={(password) => void handleImportPassword(step.jwk, password)}
            submitting={submitting}
            serverError={serverError}
          />
        );
      }
      return (
        <CreatePassword
          title="Import a wallet"
          onBack={() => setStep({ kind: "import" })}
          onSubmit={(password) => handleImportPassword(step.jwk, password)}
          submitting={submitting}
          serverError={serverError}
        />
      );

    case "claim":
      return (
        <ClaimStep
          runtime={runtime}
          walletId={step.wallet.id}
          onClaimed={(membership) =>
            claim === "founding"
              ? setStep({ kind: "reveal", wallet: step.wallet, inviteCode: membership.inviteCode })
              : onComplete()
          }
          onSkip={onComplete}
        />
      );

    case "reveal":
      return (
        <FoundingRevealScreen
          runtime={runtime}
          walletId={step.wallet.id}
          address={step.wallet.address}
          inviteCode={step.inviteCode}
          onDone={onComplete}
        />
      );
  }
}
