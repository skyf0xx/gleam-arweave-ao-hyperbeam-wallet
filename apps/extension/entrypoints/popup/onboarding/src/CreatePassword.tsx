import { useState } from "react";
import {
  ScreenHeader,
  StepDots,
  PasswordField,
  PasswordStrengthMeter,
} from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { validatePassword } from "@gleam/core/src/vault/password-policy.ts";

/**
 * 1.2 Create wallet — password (onboarding.html) — reused for both the
 * create and import flows (TODO.md 1.4: "reuse 1.2's password screen
 * after"). Client-side `validatePassword` gives an inline message as the
 * user types; the same check runs again in the handler, since a UI-only
 * check is bypassable and never the actual enforcement point.
 */
export interface CreatePasswordProps {
  title?: string;
  onBack: () => void;
  onSubmit: (password: string) => void;
  submitting?: boolean;
  serverError?: string;
}

function strengthBars(password: string): number {
  if (password.length === 0) return 0;
  let score = 1;
  if (password.length >= 10) score += 1;
  if (password.length >= 16) score += 1;
  if (/[0-9]/.test(password) && /[^a-zA-Z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}

export function CreatePassword({
  title = "Create a wallet",
  onBack,
  onSubmit,
  submitting = false,
  serverError,
}: CreatePasswordProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);

  const validation = validatePassword(password);
  const confirmMismatch = touched && confirm.length > 0 && confirm !== password;

  const passwordError = touched && !validation.valid ? validation.reason : serverError;
  const confirmError = confirmMismatch ? "Passwords don't match." : undefined;

  const canSubmit = validation.valid && password === confirm && !submitting;

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader
        title={title}
        onBack={onBack}
        subtitle={<StepDots total={2} current={1} />}
      />
      <form
        className="flex flex-1 flex-col gap-5 px-6 py-6"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (validation.valid && password === confirm) {
            onSubmit(password);
          }
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-[#111111]">Set a password</h1>
          <p className="text-[13px] leading-relaxed text-[#737373]">
            This password encrypts your wallet on this device. We can&apos;t reset it for you
            &mdash; if you lose it, you&apos;ll need your backup instead.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <PasswordField
            label="Password"
            placeholder="At least 10 characters"
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setTouched(true)}
            errorMessage={passwordError}
          />
          <PasswordStrengthMeter filled={strengthBars(password)} />
        </div>

        <PasswordField
          label="Confirm password"
          placeholder="Re-enter your password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          onBlur={() => setTouched(true)}
          errorMessage={confirmError}
        />

        <Button type="submit" disabled={!canSubmit} className="mt-8 w-full rounded-[10px] py-3">
          {submitting ? "Creating…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
