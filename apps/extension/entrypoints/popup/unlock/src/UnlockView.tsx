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
  /**
   * Called once `resetAllWallets` has run and the reset flow should
   * return to onboarding. Wiring this call through `RuntimePort` requires
   * a `ProtocolMap` entry that doesn't exist yet — see the handler-level
   * `resetAllWallets` doc comment and this task's final report.
   */
  onResetComplete: () => void;
}

export function UnlockView({ runtime, onUnlocked, onResetComplete }: UnlockViewProps) {
  const [step, setStep] = useState<Step>({ kind: "unlock" });
  const [unlocking, setUnlocking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

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
    return (
      <ForgotPassword
        onReset={() => {
          // `resetAllWallets` has no `ProtocolMap` entry yet (see this
          // view's doc comment) — `onResetComplete` is called
          // optimistically so the flow is demonstrable end-to-end once
          // that wire-contract gap is closed by a later change.
          onResetComplete();
        }}
        onCancel={() => setStep({ kind: "unlock" })}
      />
    );
  }

  return (
    <UnlockScreen
      onUnlock={handleUnlock}
      unlocking={unlocking}
      errorMessage={errorMessage}
      onForgotPassword={() => setStep({ kind: "forgot-password" })}
    />
  );
}
