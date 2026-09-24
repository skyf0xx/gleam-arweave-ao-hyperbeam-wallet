import { useState } from "react";
import { BeamMark, PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

/**
 * 1.5 Unlock screen (unlock-screen.html) — a pure brand moment, global
 * unlock. Per RELEVANT RULES: no per-wallet identity (avatar/name/
 * address) rendered here at all — this component doesn't even accept a
 * wallet prop, on purpose, so it can't regress into showing one.
 */
export interface UnlockScreenProps {
  onUnlock: (password: string) => void;
  unlocking?: boolean;
  errorMessage?: string;
  onForgotPassword: () => void;
  /** Line under the wordmark. The approval window says why it's asking. */
  tagline?: string;
}

export function UnlockScreen({
  onUnlock,
  unlocking = false,
  errorMessage,
  onForgotPassword,
  tagline = "Simple. Fast. Easy.",
}: UnlockScreenProps) {
  const [password, setPassword] = useState("");
  const [capsLockOn, setCapsLockOn] = useState(false);

  // Clear the typed password once a fresh unlock failure arrives, without
  // an effect (react-hooks/set-state-in-effect): adjust state during
  // render, keyed off the errorMessage identity we last cleared for, per
  // https://react.dev/learn/you-might-not-need-an-effect.
  const [clearedFor, setClearedFor] = useState<string | undefined>(undefined);
  if (!unlocking && errorMessage && errorMessage !== clearedFor) {
    setClearedFor(errorMessage);
    setPassword("");
  }

  return (
    <div className="flex min-h-full flex-col items-center px-8 pb-6 pt-7">
      <div className="h-2 w-full" aria-hidden="true" />
      <div className="mt-16 mb-2">
        <BeamMark tagline={tagline} />
      </div>

      <form
        className="mt-12 flex w-full flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!unlocking && password.length > 0) onUnlock(password);
        }}
      >
        <PasswordField
          label="Password"
          placeholder="Enter your password"
          autoFocus
          autoComplete="current-password"
          value={password}
          disabled={unlocking}
          onChange={(event) => setPassword(event.target.value)}
          onKeyUp={(event) => setCapsLockOn(event.getModifierState?.("CapsLock") ?? false)}
          capsLockOn={capsLockOn}
          errorMessage={errorMessage}
        />

        <Button
          type="submit"
          disabled={unlocking || password.length === 0}
          aria-busy={unlocking}
          className="mt-1.5"
        >
          {unlocking ? (
            <>
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/35 border-t-background motion-reduce:animate-none"
              />
              <span>Unlocking&hellip;</span>
            </>
          ) : (
            "Unlock"
          )}
        </Button>
      </form>

      <div className="mt-3.5 flex justify-center">
        <button
          type="button"
          disabled={unlocking}
          onClick={onForgotPassword}
          className="p-1 text-label font-medium text-muted hover:text-foreground hover:underline"
        >
          Forgot password?
        </button>
      </div>
    </div>
  );
}
