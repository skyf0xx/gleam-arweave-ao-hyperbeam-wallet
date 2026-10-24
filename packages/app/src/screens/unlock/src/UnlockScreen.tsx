import { useMemo, useState } from "react";
import type { SecurityPhrase } from "@gleam/core";
import { BeamMark, PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { SecurityPhraseMark } from "@gleam/ui/src/components/security-phrase/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { securityPhraseIconSvg } from "../../../security-phrase-icon";

/**
 * A pure brand moment, global unlock: no per-wallet identity (avatar/name/
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
  /** Present when a passkey is set up. It becomes the primary way in, with the password one tap away. */
  passkey?: PasskeyUnlockProps;
  /** The user's anti-phishing phrase, when one is set. */
  securityPhrase?: SecurityPhrase | null;
}

export interface PasskeyUnlockProps {
  onUnlock: () => void;
  busy: boolean;
  /** Why the last passkey attempt didn't unlock. A cancel is `muted`, not an error. */
  notice?: { text: string; tone: "muted" | "error" };
}

export function UnlockScreen({
  onUnlock,
  unlocking = false,
  errorMessage,
  onForgotPassword,
  tagline = "Simple. Fast. Easy.",
  passkey,
  securityPhrase,
}: UnlockScreenProps) {
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [capsLockOn, setCapsLockOn] = useState(false);
  const phraseWord = securityPhrase?.word;
  const phraseIcon = useMemo(() => (phraseWord ? securityPhraseIconSvg(phraseWord) : undefined), [phraseWord]);

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
      {securityPhrase && phraseIcon ? (
        <SecurityPhraseMark phrase={securityPhrase} iconSvg={phraseIcon} layout="stacked" className="mt-6" />
      ) : null}

      {passkey && !usePassword ? (
        <PasskeyUnlock
          {...passkey}
          disabled={unlocking}
          onUsePassword={() => setUsePassword(true)}
        />
      ) : (
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
                <Spinner />
                <span>Unlocking&hellip;</span>
              </>
            ) : (
              "Unlock"
            )}
          </Button>
        </form>
      )}

      <div className="mt-3.5 flex justify-center gap-4">
        {passkey && usePassword ? (
          <button
            type="button"
            disabled={unlocking}
            onClick={() => setUsePassword(false)}
            className="p-1 text-label font-medium text-muted hover:text-foreground hover:underline"
          >
            Use passkey
          </button>
        ) : null}
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

function PasskeyUnlock({
  onUnlock,
  busy,
  notice,
  disabled,
  onUsePassword,
}: PasskeyUnlockProps & { disabled: boolean; onUsePassword: () => void }) {
  return (
    <div className="mt-12 flex w-full flex-col gap-2.5">
      <Button type="button" autoFocus disabled={busy || disabled} aria-busy={busy} onClick={onUnlock}>
        {busy ? (
          <>
            <Spinner />
            <span>Waiting for passkey&hellip;</span>
          </>
        ) : (
          <>
            <PasskeyIcon />
            <span>Unlock with passkey</span>
          </>
        )}
      </Button>
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={notice.tone === "error" ? "text-center text-caption text-warning" : "text-center text-caption text-muted"}
        >
          {notice.text}
        </p>
      ) : null}
      <Button type="button" variant="secondary" disabled={busy || disabled} onClick={onUsePassword}>
        Use password instead
      </Button>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/35 border-t-background motion-reduce:animate-none"
    />
  );
}

export function PasskeyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3 20a6 6 0 0 1 9.5-4.9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="17.5" cy="14.5" r="2.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M17.5 17v4m0-2h1.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
