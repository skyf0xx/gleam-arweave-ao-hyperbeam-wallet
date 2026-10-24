import { useEffect, useState } from "react";
import type { PasskeyStatus, RuntimePort, SecurityPhrase } from "@gleam/core";
import { UnlockScreen, type PasskeyUnlockProps } from "./UnlockScreen";
import { usePlatform } from "../../../app-platform/context";
import { ForgotPassword } from "./ForgotPassword";
import { PasskeyError } from "../../../passkey/webauthn";
import { unlockWithPasskey } from "./passkey-unlock";

/**
 * Unlock view module (`screens/unlock/`) — same "folder, not a
 * new WXT entrypoint" shape as `onboarding/`. See `OnboardingView`'s
 * comment.
 */
type Step = { kind: "unlock" } | { kind: "forgot-password" };

export interface UnlockViewProps {
  runtime: RuntimePort;
  onUnlocked: () => void;
  /** Called once the real `resetAllWallets` RPC call has resolved successfully. */
  onResetComplete: () => void;
  tagline?: string;
  /** Starts the passkey prompt as soon as the passkey is known, for the passkey window the user just asked for. */
  autoStartPasskey?: boolean;
}

type Enrolled = Extract<PasskeyStatus, { enrolled: true }>;

export function UnlockView({
  runtime,
  onUnlocked,
  onResetComplete,
  tagline,
  autoStartPasskey = false,
}: UnlockViewProps) {
  const { unlock } = usePlatform();
  const [step, setStep] = useState<Step>({ kind: "unlock" });
  const [unlocking, setUnlocking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [resetting, setResetting] = useState(false);
  const [resetErrorMessage, setResetErrorMessage] = useState<string>();
  const [passkey, setPasskey] = useState<Enrolled | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyNotice, setPasskeyNotice] = useState<PasskeyUnlockProps["notice"]>();
  const [securityPhrase, setSecurityPhrase] = useState<SecurityPhrase | null>(null);

  const handlePasskeyUnlock = async (status: Enrolled) => {
    setPasskeyBusy(true);
    setPasskeyNotice(undefined);
    try {
      if (unlock.passkeyMode === "window") {
        await unlock.openPasskeyWindow("unlock");
        return;
      }
      await unlockWithPasskey(runtime, status);
      onUnlocked();
    } catch (error) {
      setPasskeyNotice(passkeyNoticeFor(error));
      // The background drops a passkey that no longer matches the password.
      const latest = await readPasskeyStatus(runtime);
      if (latest?.enrolled === false) setPasskey(null);
    } finally {
      setPasskeyBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void readSecurityPhrase(runtime).then((phrase) => {
      if (!cancelled) setSecurityPhrase(phrase);
    });
    void (async () => {
      const status = await readPasskeyStatus(runtime);
      if (cancelled || !status?.enrolled) return;
      setPasskey(status);
      if (autoStartPasskey) void handlePasskeyUnlock(status);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per runtime: a re-render must never start a second prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  const handleUnlock = async (password: string) => {
    setUnlocking(true);
    setErrorMessage(undefined);
    try {
      await runtime.send<{ password: string }, { unlockedWalletIds: string[] }>({
        type: "unlockWallet",
        payload: { password },
      });
      onUnlocked();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "That password didn't work. Try again, or use your recovery method.",
      );
    } finally {
      setUnlocking(false);
    }
  };

  if (step.kind === "forgot-password") {
    const handleReset = async () => {
      setResetting(true);
      setResetErrorMessage(undefined);
      try {
        await runtime.send<void, void>({ type: "resetAllWallets", payload: undefined });
        onResetComplete();
      } catch (error) {
        setResetErrorMessage(
          error instanceof Error ? error.message : "Couldn't reset the wallet. Try again.",
        );
      } finally {
        setResetting(false);
      }
    };

    return (
      <ForgotPassword
        onReset={handleReset}
        onCancel={() => setStep({ kind: "unlock" })}
        resetting={resetting}
        errorMessage={resetErrorMessage}
      />
    );
  }

  return (
    <UnlockScreen
      onUnlock={handleUnlock}
      unlocking={unlocking}
      errorMessage={errorMessage}
      onForgotPassword={() => setStep({ kind: "forgot-password" })}
      tagline={tagline}
      securityPhrase={securityPhrase}
      passkey={
        passkey
          ? { onUnlock: () => void handlePasskeyUnlock(passkey), busy: passkeyBusy, notice: passkeyNotice }
          : undefined
      }
    />
  );
}

/** Null when none is set or it can't be read. */
async function readSecurityPhrase(runtime: RuntimePort): Promise<SecurityPhrase | null> {
  try {
    return (await runtime.send<void, SecurityPhrase | null>({ type: "getSecurityPhrase", payload: undefined })) ?? null;
  } catch {
    return null;
  }
}

/** Null when the status can't be read: no passkey button, and the password still works. */
async function readPasskeyStatus(runtime: RuntimePort): Promise<PasskeyStatus | null> {
  try {
    const status = await runtime.send<void, PasskeyStatus>({ type: "getPasskeyStatus", payload: undefined });
    return status?.enrolled === true || status?.enrolled === false ? status : null;
  } catch {
    return null;
  }
}

function passkeyNoticeFor(error: unknown): NonNullable<PasskeyUnlockProps["notice"]> {
  if (error instanceof PasskeyError && error.reason === "cancelled") {
    return { text: "Passkey cancelled. Try again, or use your password.", tone: "muted" };
  }
  return { text: error instanceof Error ? error.message : String(error), tone: "error" };
}
