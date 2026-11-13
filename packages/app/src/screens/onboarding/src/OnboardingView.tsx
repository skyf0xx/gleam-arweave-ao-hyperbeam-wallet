import { useEffect, useState } from "react";
import type { HardwareWalletMethod, RuntimePort, SecurityPhrase, WalletSummary } from "@gleam/core";
import {
  downloadKeyfile,
  keyfileDownloadError,
  type RequestDownloadsPermission,
} from "../../../keyfile/download";
import { Welcome } from "./Welcome";
import { CreatePassword } from "./CreatePassword";
import { Backup } from "./Backup";
import { Import } from "./Import";
import { ImportPhrase } from "./ImportPhrase";
import { AddWalletStart } from "./AddWalletStart";
import { ExistingWallet } from "./ExistingWallet";
import { RestoreBackup } from "./RestoreBackup";
import { backupAccountName } from "../../backup/index.tsx";
import { ConnectDevice } from "./ConnectDevice";
import { WatchAddress } from "./WatchAddress";
import { usePlatform } from "../../../app-platform/context";
import { VaultPassword } from "./VaultPassword";
import { ClaimStep, type ClaimPhase } from "./ClaimStep";
import { FoundingRevealScreen } from "./FoundingReveal";
import { SecurityPhraseStep } from "./SecurityPhraseStep";
import { t as translate, useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { PasskeyError, passkeysAvailable, readAnyPasskeyPrf } from "../../../passkey/webauthn";

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
  // `passkeys` are the ones the backup lists that this device can prompt for.
  | { kind: "restore"; account: string; passkeys: { credentialId: string; prfSalt: string }[] }
  | { kind: "create-password" }
  // The password is kept only until the first download attempt resolves,
  // so the background can decrypt the keyfile when the user saves it.
  | { kind: "backup"; password: string | null; wallet: WalletSummary }
  | { kind: "import" }
  | { kind: "import-phrase" }
  // `from` is the screen Back returns to.
  | { kind: "import-password"; jwk: unknown; from: "import" | "import-phrase" }
  | { kind: "connect-device"; device: HardwareWalletMethod }
  | { kind: "watch" }
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
   * Add-wallet only: false when every wallet so far is a hardware or watch wallet.
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
  /** Opens the Keystone connect page. Defaults to the platform's connect view or page. */
  onConnectKeystone?: () => void;
  /** Opens the Ledger connect page. Defaults to the platform's connect view or page. */
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

/** Set while a restore is between finding the backup and finishing it. */
const RESTORE_PENDING_KEY = "session:onboardingRestorePending";

function randomDefaultWalletName(): string {
  return DEFAULT_WALLET_NAMES[Math.floor(Math.random() * DEFAULT_WALLET_NAMES.length)]!;
}

export function OnboardingView({ runtime, onComplete, mode = "first-run", vaultHasPassword = true, onCancel, claim, onConnectKeystone, onConnectLedger, requestDownloadPermission }: OnboardingViewProps) {
  const t = useT();
  const { hardwareWallets, downloads, capabilities, ephemeralState } = usePlatform();
  const [step, setStep] = useState<Step>({ kind: "welcome" });
  const connectDevice = (device: HardwareWalletMethod) => {
    if (hardwareWallets.connectViews[device]) setStep({ kind: "connect-device", device });
    else void hardwareWallets.openConnectPage(device);
  };
  const connectKeystone = onConnectKeystone ?? (() => connectDevice("keystone"));
  const connectLedger = onConnectLedger ?? (() => connectDevice("ledger"));
  const requestPermission = requestDownloadPermission ?? downloads.requestPermission;
  const addingWallet = mode === "add-wallet";
  const askVaultPassword = addingWallet && vaultHasPassword;
  const [submitting, setSubmitting] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [backup, setBackup] = useState<{ downloading: boolean; savedAs: string | null; error: string | null }>({
    downloading: false,
    savedAs: null,
    error: null,
  });

  // A first run can restore from wherever this shell keeps a vault backup.
  const restoreAccount = !addingWallet && capabilities.cloudBackup ? backupAccountName(capabilities.cloudBackup) : null;

  // The Google sign-in window closes the action popup. The background
  // carries on, so a popup reopened mid-restore picks it up where it was.
  const [resuming, setResuming] = useState(restoreAccount !== null);

  const findBackup = async (account: string) => {
    setSubmitting(true);
    setServerError(undefined);
    await ephemeralState.set(RESTORE_PENDING_KEY, true).catch(() => {});
    try {
      const { found, passkeys } = await runtime.send<void, { found: boolean; passkeys?: { credentialId: string; prfSalt: string }[] }>({
        type: "findBackup",
        payload: undefined,
      });
      if (found) {
        setStep({ kind: "restore", account, passkeys: capabilities.passkey && passkeysAvailable() ? (passkeys ?? []) : [] });
        return;
      }
      setServerError(t("errors.backupFileMissing"));
    } catch (error) {
      setServerError(errorText(error));
    } finally {
      setSubmitting(false);
    }
    await ephemeralState.remove(RESTORE_PENDING_KEY).catch(() => {});
  };

  useEffect(() => {
    if (restoreAccount === null) return;
    let cancelled = false;
    void ephemeralState
      .get(RESTORE_PENDING_KEY)
      .catch(() => undefined)
      .then((pending) => {
        if (cancelled) return;
        setResuming(false);
        if (pending !== true) return;
        setStep({ kind: "existing" });
        void findBackup(restoreAccount);
      });
    return () => {
      cancelled = true;
    };
    // Once, on mount: a later render must not restart a restore the user backed out of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leaveRestore = () => {
    void ephemeralState.remove(RESTORE_PENDING_KEY).catch(() => {});
    setServerError(undefined);
    setStep({ kind: "existing" });
  };

  const restoreWith = async (open: () => Promise<{ password: string } | { credentialId: string; prfOutput: string }>) => {
    setSubmitting(true);
    setServerError(undefined);
    try {
      const payload = await open();
      setPasskeyBusy(false);
      await runtime.send<typeof payload, { unlockedWalletIds: string[] }>({ type: "restoreBackup", payload });
      await ephemeralState.remove(RESTORE_PENDING_KEY).catch(() => {});
      onComplete();
    } catch (error) {
      setServerError(error instanceof PasskeyError ? error.message : errorText(error));
    } finally {
      setPasskeyBusy(false);
      setSubmitting(false);
    }
  };

  const handleRestore = (password: string) => restoreWith(async () => ({ password }));
  const handleRestorePasskey = (passkeys: { credentialId: string; prfSalt: string }[]) =>
    restoreWith(() => {
      setPasskeyBusy(true);
      return readAnyPasskeyPrf(passkeys);
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
      setServerError(errorText(error));
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
      error = errorText(caught);
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
      error: translate("onboarding.backupFailed", { reason: reason ?? translate("onboarding.keyfileNotSaved") }),
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
      setServerError(errorText(error));
    } finally {
      setSubmitting(false);
    }
  };

  // Blank for the moment it takes to read, rather than flashing Welcome before the restore step.
  if (resuming) return null;

  switch (step.kind) {
    case "welcome":
      if (addingWallet) {
        return (
          <AddWalletStart
            onBack={() => onCancel?.()}
            onCreate={() => setStep({ kind: "create-password" })}
            onImport={() => setStep({ kind: "import" })}
            onImportPhrase={() => setStep({ kind: "import-phrase" })}
            onConnectKeystone={connectKeystone}
            onConnectLedger={connectLedger}
            onWatch={() => setStep({ kind: "watch" })}
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
          onImportPhrase={() => setStep({ kind: "import-phrase" })}
          onConnectKeystone={connectKeystone}
          onConnectLedger={connectLedger}
          onWatch={() => setStep({ kind: "watch" })}
          restore={
            restoreAccount
              ? {
                  account: restoreAccount,
                  onRestore: () => void findBackup(restoreAccount),
                  busy: submitting,
                  error: serverError,
                }
              : undefined
          }
        />
      );

    case "restore":
      return (
        <RestoreBackup
          account={step.account}
          onBack={leaveRestore}
          onSubmit={(password) => void handleRestore(password)}
          onUsePasskey={step.passkeys.length > 0 ? () => void handleRestorePasskey(step.passkeys) : undefined}
          passkeyBusy={passkeyBusy}
          submitting={submitting}
          serverError={serverError}
        />
      );

    case "watch":
      return (
        <WatchAddress
          runtime={runtime}
          onBack={() => setStep({ kind: addingWallet ? "welcome" : "existing" })}
          // A watch wallet can't sign, so it skips the Points claim, which needs a signature.
          onAdded={onComplete}
        />
      );

    case "create-password":
      if (askVaultPassword) {
        return (
          <VaultPassword
            title={t("onboarding.createWallet")}
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
          onValidJWK={(jwk) => setStep({ kind: "import-password", jwk, from: "import" })}
        />
      );

    case "import-phrase":
      return (
        <ImportPhrase
          onBack={() => setStep({ kind: addingWallet ? "welcome" : "existing" })}
          onValidJWK={(jwk) => setStep({ kind: "import-password", jwk, from: "import-phrase" })}
        />
      );

    case "connect-device":
      return (
        <ConnectDevice
          device={step.device}
          runtime={runtime}
          // Both ways in list the devices: the add-wallet start, or first
          // run's "I already have a wallet".
          onBack={() => setStep({ kind: addingWallet ? "welcome" : "existing" })}
          onConnected={onComplete}
        />
      );

    case "import-password":
      if (askVaultPassword) {
        return (
          <VaultPassword
            title={t("onboarding.importWallet")}
            onBack={() => setStep({ kind: step.from })}
            onSubmit={(password) => void handleImportPassword(step.jwk, password)}
            submitting={submitting}
            serverError={serverError}
          />
        );
      }
      return (
        <CreatePassword
          title={t("onboarding.importWallet")}
          onBack={() => setStep({ kind: step.from })}
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
