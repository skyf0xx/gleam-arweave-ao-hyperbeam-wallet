import { useMemo, useState, type ReactNode } from "react";
import type { SecurityPhrase } from "@gleam/core";
import { BeamMark, PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { SecurityPhraseMark } from "@gleam/ui/src/components/security-phrase/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
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
  /** Present when biometric unlock is set up. It takes the passkey's place. */
  biometrics?: BiometricUnlockProps;
  /** The user's anti-phishing phrase, when one is set. */
  securityPhrase?: SecurityPhrase | null;
}

export interface PasskeyUnlockProps {
  onUnlock: () => void;
  busy: boolean;
  /** Why the last passkey attempt didn't unlock. A cancel is `muted`, not an error. */
  notice?: { text: string; tone: "muted" | "error" };
}

export interface BiometricUnlockProps extends PasskeyUnlockProps {
  /** What the device calls it, mid-sentence: "Face ID", "fingerprint". */
  label: string;
}

interface QuickUnlock extends PasskeyUnlockProps {
  icon: ReactNode;
  action: string;
  waiting: string;
  switchBack: string;
}

function quickUnlockFor(passkey?: PasskeyUnlockProps, biometrics?: BiometricUnlockProps): QuickUnlock | undefined {
  if (biometrics) {
    return {
      ...biometrics,
      icon: <BiometricIcon />,
      action: `Unlock with ${biometrics.label}`,
      waiting: `Waiting for ${biometrics.label}…`,
      switchBack: `Use ${biometrics.label}`,
    };
  }
  if (passkey) {
    return {
      ...passkey,
      icon: <PasskeyIcon />,
      action: "Unlock with passkey",
      waiting: "Waiting for passkey…",
      switchBack: "Use passkey",
    };
  }
  return undefined;
}

export function UnlockScreen({
  onUnlock,
  unlocking = false,
  errorMessage,
  onForgotPassword,
  tagline = "Simple. Fast. Easy.",
  passkey,
  biometrics,
  securityPhrase,
}: UnlockScreenProps) {
  const quick = quickUnlockFor(passkey, biometrics);
  // The form and the links stay disabled while the other way in is running.
  const locked = unlocking || (quick?.busy ?? false);
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

  const links = (
    <div className="mt-3.5 flex justify-center gap-4">
      {quick && usePassword ? (
        <button
          type="button"
          disabled={locked}
          onClick={() => setUsePassword(false)}
          className="p-1 text-label font-medium text-muted hover:text-foreground hover:underline phone:flex phone:min-h-11 phone:items-center phone:px-3"
        >
          {quick.switchBack}
        </button>
      ) : null}
      <button
        type="button"
        disabled={locked}
        onClick={onForgotPassword}
        className="p-1 text-label font-medium text-muted hover:text-foreground hover:underline phone:flex phone:min-h-11 phone:items-center phone:px-3"
      >
        Forgot password?
      </button>
    </div>
  );

  return (
    <div className="flex min-h-full flex-col items-center px-8 phone:px-5 pb-6 phone:pb-0 pt-7 phone:pt-4">
      <div className="h-2 w-full" aria-hidden="true" />
      {/* With the keyboard up there is no room for the wordmark; the security phrase below it stays. */}
      <div className="mt-16 mb-2 phone:mt-6 phone:[@media(max-height:560px)]:hidden">
        <BeamMark tagline={tagline} />
      </div>
      {securityPhrase && phraseIcon ? (
        <SecurityPhraseMark phrase={securityPhrase} iconSvg={phraseIcon} layout="stacked" className="mt-6 phone:mt-4" />
      ) : null}

      {quick && !usePassword ? (
        <QuickUnlockButtons
          {...quick}
          disabled={locked}
          onUsePassword={() => setUsePassword(true)}
          links={links}
        />
      ) : (
        <form
          className="mt-12 flex w-full flex-col gap-2.5 phone:mt-8 phone:flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!locked && password.length > 0) onUnlock(password);
          }}
        >
          <PasswordField
            label="Password"
            placeholder="Enter your password"
            autoFocus
            autoComplete="current-password"
            value={password}
            disabled={locked}
            onChange={(event) => setPassword(event.target.value)}
            onKeyUp={(event) => setCapsLockOn(event.getModifierState?.("CapsLock") ?? false)}
            capsLockOn={capsLockOn}
            errorMessage={errorMessage}
          />

          <ScreenFooter className="mt-1.5 gap-0">
            <Button type="submit" disabled={locked || password.length === 0} aria-busy={unlocking}>
              {unlocking ? (
                <>
                  <Spinner />
                  <span>Unlocking&hellip;</span>
                </>
              ) : (
                "Unlock"
              )}
            </Button>
            {links}
          </ScreenFooter>
        </form>
      )}

    </div>
  );
}

function QuickUnlockButtons({
  onUnlock,
  busy,
  notice,
  icon,
  action,
  waiting,
  disabled,
  onUsePassword,
  links,
}: QuickUnlock & { disabled: boolean; onUsePassword: () => void; links: ReactNode }) {
  return (
    <ScreenFooter className="mt-12 gap-0">
      <Button type="button" autoFocus disabled={busy || disabled} aria-busy={busy} onClick={onUnlock}>
        {busy ? (
          <>
            <Spinner />
            <span>{waiting}</span>
          </>
        ) : (
          <>
            {icon}
            <span>{action}</span>
          </>
        )}
      </Button>
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={notice.tone === "error" ? "mt-2.5 text-center text-caption text-warning" : "mt-2.5 text-center text-caption text-muted"}
        >
          {notice.text}
        </p>
      ) : null}
      <Button type="button" variant="secondary" disabled={busy || disabled} onClick={onUsePassword} className="mt-2.5">
        Use password instead
      </Button>
      {links}
    </ScreenFooter>
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

export function BiometricIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 16a3.5 3.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
