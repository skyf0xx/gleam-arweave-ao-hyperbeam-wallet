import { useState } from "react";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { Welcome } from "./Welcome";
import { CreatePassword } from "./CreatePassword";
import { Backup } from "./Backup";
import { Import } from "./Import";
import { AddWalletStart } from "./AddWalletStart";
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
  | { kind: "create-password" }
  | { kind: "backup"; keyfileContents: string; walletName: string; wallet: WalletSummary }
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

export function OnboardingView({ runtime, onComplete, mode = "first-run", onCancel, claim }: OnboardingViewProps) {
  const addingWallet = mode === "add-wallet";
  const [step, setStep] = useState<Step>({ kind: "welcome" });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>();

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
      // `exportWallet` re-decrypts the just-created envelope rather than
      // this view module ever holding the plaintext JWK itself — the
      // password already left this component's state by this point.
      const jwk = await runtime.send<{ walletId: string; password: string }, unknown>({
        type: "exportWallet",
        payload: { walletId: summary.id, password },
      });
      setStep({
        kind: "backup",
        keyfileContents: JSON.stringify(jwk),
        walletName: summary.name,
        wallet: summary,
      });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
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
          />
        );
      }
      return (
        <Welcome
          onCreate={() => setStep({ kind: "create-password" })}
          onImport={() => setStep({ kind: "import" })}
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
          // start would only offer to create another one.
          onBack={onComplete}
          keyfileContents={step.keyfileContents}
          onDownload={() => downloadKeyfile(step.keyfileContents, step.walletName)}
          onCopy={() => void navigator.clipboard?.writeText(step.keyfileContents)}
          onContinue={() => finish(step.wallet)}
        />
      );

    case "import":
      return (
        <Import
          onBack={() => setStep({ kind: "welcome" })}
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

function downloadKeyfile(contents: string, walletName: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${walletName.replace(/\s+/g, "-").toLowerCase()}-arweave-keyfile.json`;
  link.click();
  URL.revokeObjectURL(url);
}
