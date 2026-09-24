import { useState } from "react";
import type { RuntimePort } from "@gleam/core";
import { UnlockScreen } from "./UnlockScreen";
import { ForgotPassword } from "./ForgotPassword";

/**
 * Unlock view module (`entrypoints/popup/unlock/`) — same "folder, not a
 * new WXT entrypoint" shape as `onboarding/`. See `OnboardingView`'s
 * comment and this task's final report for the `App.tsx` wiring gap.
 */
type Step = { kind: "unlock" } | { kind: "forgot-password" };

export interface UnlockViewProps {
  runtime: RuntimePort;
  onUnlocked: () => void;
  /** Called once the real `resetAllWallets` RPC call has resolved successfully. */
  onResetComplete: () => void;
  tagline?: string;
}

export function UnlockView({ runtime, onUnlocked, onResetComplete, tagline }: UnlockViewProps) {
  const [step, setStep] = useState<Step>({ kind: "unlock" });
  const [unlocking, setUnlocking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [resetting, setResetting] = useState(false);
  const [resetErrorMessage, setResetErrorMessage] = useState<string>();

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
    />
  );
}
