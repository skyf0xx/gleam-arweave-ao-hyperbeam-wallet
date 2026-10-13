import { useState } from "react";
import type { RuntimePort } from "@gleam/core";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { PasskeyIcon } from "@/entrypoints/popup/unlock/src/UnlockScreen";
import { createUnlockPasskey, PasskeyError, type CreatedPasskey } from "@/src/passkey/webauthn";

export interface PasskeySetupProps {
  runtime: RuntimePort;
  onDone: () => void;
  /** The WebAuthn ceremony. Injected so tests don't need an authenticator. */
  createPasskey?: () => Promise<CreatedPasskey>;
}

type Phase = "idle" | "checking" | "creating" | "saving" | "done";

/**
 * Passkey setup: one screen that explains the trade, confirms the
 * password, then hands over to the browser's passkey prompt. The password
 * is checked before the prompt, so a typo never leaves an unusable
 * passkey in the user's password manager.
 */
export function PasskeySetup({ runtime, onDone, createPasskey = createUnlockPasskey }: PasskeySetupProps) {
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [passwordError, setPasswordError] = useState<string>();
  const [notice, setNotice] = useState<{ text: string; tone: "muted" | "error" }>();

  const busy = phase === "checking" || phase === "creating" || phase === "saving";

  const handleSubmit = async () => {
    setPasswordError(undefined);
    setNotice(undefined);
    setPhase("checking");
    try {
      await runtime.send({ type: "checkVaultPassword", payload: { password } });
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : String(error));
      setPhase("idle");
      return;
    }

    setPhase("creating");
    let created: CreatedPasskey;
    try {
      created = await createPasskey();
    } catch (error) {
      setNotice(
        error instanceof PasskeyError && error.reason === "cancelled"
          ? { text: "Passkey cancelled. Try again when you're ready.", tone: "muted" }
          : { text: error instanceof Error ? error.message : String(error), tone: "error" },
      );
      setPhase("idle");
      return;
    }

    setPhase("saving");
    try {
      await runtime.send({ type: "enrollPasskey", payload: { password, ...created } });
      setPassword("");
      setPhase("done");
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), tone: "error" });
      setPhase("idle");
    }
  };

  if (phase === "done") {
    return (
      <div className="flex min-h-screen flex-col">
        <ScreenHeader title="Passkey" />
        <div className="flex flex-1 flex-col px-6 pb-6 pt-16">
          <div className="flex flex-col items-center gap-5 text-center">
            <Beam className="w-10 gleam-beam-sweep" />
            <div className="flex flex-col gap-1.5">
              <h1 className="text-h3 font-semibold tracking-tight">Passkey ready</h1>
              <p className="text-body leading-relaxed text-muted">
                Next time, choose Unlock with passkey. Your password still works too.
              </p>
            </div>
          </div>
          <Button type="button" autoFocus className="mt-auto" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ScreenHeader title="Passkey" />
      <form
        className="flex flex-1 flex-col gap-6 px-6 pb-6 pt-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && password.length > 0) void handleSubmit();
        }}
      >
        <div className="flex flex-col gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-mist text-foreground">
            <PasskeyIcon size={20} />
          </span>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-h3 font-semibold tracking-tight">Unlock with a passkey</h1>
            <p className="text-body leading-relaxed text-muted">
              Use your fingerprint, face, screen lock or a security key instead of typing your password.
            </p>
          </div>
        </div>

        <PasswordField
          label="Password"
          placeholder="Enter your Gleam password"
          autoFocus
          autoComplete="current-password"
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
          errorMessage={passwordError}
        />

        <p className="border-t border-line pt-4 text-caption leading-relaxed text-faint">
          Your password still unlocks Gleam. Keep it: you&apos;ll need it if you lose this passkey.
        </p>

        <div className="mt-auto flex flex-col gap-2.5">
          {notice ? (
            <p
              role={notice.tone === "error" ? "alert" : "status"}
              className={
                notice.tone === "error" ? "text-center text-caption text-warning" : "text-center text-caption text-muted"
              }
            >
              {notice.text}
            </p>
          ) : null}
          {phase === "creating" ? (
            <p role="status" className="text-center text-caption text-muted">
              Follow your browser&apos;s prompt.
            </p>
          ) : null}
          <Button type="submit" disabled={busy || password.length === 0} aria-busy={busy}>
            {busy ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/35 border-t-background motion-reduce:animate-none"
                />
                <span>{phase === "creating" ? "Waiting for passkey…" : "Checking…"}</span>
              </>
            ) : (
              "Create passkey"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
