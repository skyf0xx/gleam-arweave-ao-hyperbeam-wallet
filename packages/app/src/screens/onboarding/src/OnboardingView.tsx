import { useState } from "react";
import type { RuntimePort, SecurityPhrase, WalletSummary } from "@gleam/core";
import {
  downloadKeyfile,
  keyfileDownloadError,
  type RequestDownloadsPermission,
} from "../../../keyfile/download";
import { Welcome } from "./Welcome";
import { CreatePassword } from "./CreatePassword";
import { Backup } from "./Backup";
import { Import } from "./Import";
import { AddWalletStart } from "./AddWalletStart";
import { ExistingWallet } from "./ExistingWallet";
import { usePlatform } from "../../../app-platform/context";
import { VaultPassword } from "./VaultPassword";
import { ClaimStep, type ClaimPhase } from "./ClaimStep";
import { FoundingRevealScreen } from "./FoundingReveal";
import { SecurityPhraseStep } from "./SecurityPhraseStep";

/**
 * Onboarding view module (`screens/onboarding/`) — a folder, not
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
  | { kind: "security-phrase"; wallet: WalletSummary }
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
  /**
   * Add-wallet only: false when every wallet so far is a hardware wallet.
   * The vault has no password yet, so the new keyfile wallet sets one.
   */
  vaultHasPassword?: boolean;
  /** Leaves the add-wallet flow from its first screen. */
  onCancel?: () => void;
  /**
   * Ends the flow on the Gleam Points claim step (and, for `founding`, the
   * founding reveal) before `onComplete`. Without it the flow ends at
   * backup or import.
   */
  claim?: ClaimPhase;
  /** Opens the Keystone connect page. Defaults to the platform's connect page. */
  onConnectKeystone?: () => void;
  /** Opens the Ledger connect page. Defaults to the platform's connect page. */
  onConnectLedger?: () => void;
  /** Asks for the optional `downloads` permission from the Download click. */
  requestDownloadPermission?: RequestDownloadsPermission;
}

// Crystal- or light-sounding, and colourless on purpose: a wallet's avatar
// has its own colour, and a name like "Ruby" on a blue avatar would read as
// the wrong wallet.
const DEFAULT_WALLET_NAMES = [
  "Brilliant",
  "Clarity",
  "Clear Quartz",
  "Crystal",
  "Dazzle",
  "Diamond",
  "Facet",
  "Blaze",
  "Flicker",
  "Glimmer",
  "Glint",
  "Glisten",
  "Glow",
  "Halo",
  "Lucent",
  "Lumen",
  "Lustre",
  "Mirror",
  "Nova",
  "Photon",
  "Prism",
  "Quartz",
  "Radiant",
  "Ray",
  "Rock Crystal",
  "Sheen",
  "Shimmer",
  "Spark",
  "Sparkle",
  "Spectrum",
  "Starlight",
  "Twinkle",
  "Zircon",
];

function randomDefaultWalletName(): string {
  return DEFAULT_WALLET_NAMES[Math.floor(Math.random() * DEFAULT_WALLET_NAMES.length)]!;
}

export function OnboardingView({ runtime, onComplete, mode = "first-run", vaultHasPassword = true, onCancel, claim, onConnectKeystone, onConnectLedger, requestDownloadPermission }: OnboardingViewProps) {
  const { hardwareWallets, downloads } = usePlatform();
  const connectKeystone = onConnectKeystone ?? (() => void hardwareWallets.openConnectPage("keystone"));
  const connectLedger = onConnectLedger ?? (() => void hardwareWallets.openConnectPage("ledger"));
  const requestPermission = requestDownloadPermission ?? downloads.requestPermission;
  const addingWallet = mode === "add-wallet";
  const askVaultPassword = addingWallet && vaultHasPassword;
  const [step, setStep] = useState<Step>({ kind: "welcome" });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [backup, setBackup] = useState<{ downloading: boolean; savedAs: string | null; error: string | null }>({
    downloading: false,
    savedAs: null,
    error: null,
  });

  const proceed = (wallet: WalletSummary) => {
    if (claim) setStep({ kind: "claim", wallet });
    else onComplete();
  };

  // The wallet that sets the password also picks the security phrase, unless one survives
  // from before a reset. If the phrase can't be read, onboarding still
  // finishes; it can be set later in Lock & unlock.
  const finish = (wallet: WalletSummary) => {
    if (askVaultPassword) return proceed(wallet);
    runtime.send<void, SecurityPhrase | null>({ type: "getSecurityPhrase", payload: undefined }).then(
      (phrase) => (phrase ? proceed(wallet) : setStep({ kind: "security-phrase", wallet })),
      () => proceed(wallet),
    );
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
      result = await downloadKeyfile(runtime, { walletId: wallet.id, password }, requestPermission);
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
            onConnectKeystone={connectKeystone}
            onConnectLedger={connectLedger}
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
          onConnectKeystone={connectKeystone}
          onConnectLedger={connectLedger}
        />
      );

    case "create-password":
      if (askVaultPassword) {
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
      if (askVaultPassword) {
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

    case "security-phrase":
      return <SecurityPhraseStep runtime={runtime} onDone={() => proceed(step.wallet)} />;

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
