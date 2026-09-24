import { useState } from "react";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

/**
 * Asks for the existing vault password when adding a wallet. Every wallet
 * shares one password, so this never offers to set a new one; the
 * background checks it against a stored wallet.
 */
export interface VaultPasswordProps {
  title: string;
  onBack: () => void;
  onSubmit: (password: string) => void;
  submitting?: boolean;
  serverError?: string;
}

export function VaultPassword({
  title,
  onBack,
  onSubmit,
  submitting = false,
  serverError,
}: VaultPasswordProps) {
  const [password, setPassword] = useState("");
  const [capsLockOn, setCapsLockOn] = useState(false);

  // Clear the field once a new rejection arrives, adjusting state during
  // render rather than in an effect (react-hooks/set-state-in-effect).
  const [clearedFor, setClearedFor] = useState<string | undefined>(undefined);
  // Reset while submitting so a repeat of the same rejection clears again.
  if (submitting && clearedFor !== undefined) setClearedFor(undefined);
  if (!submitting && serverError && serverError !== clearedFor) {
    setClearedFor(serverError);
    setPassword("");
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={title} onBack={onBack} />
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
            The new wallet is encrypted with the password you already use to unlock Gleam.
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
          {submitting ? "Adding…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
