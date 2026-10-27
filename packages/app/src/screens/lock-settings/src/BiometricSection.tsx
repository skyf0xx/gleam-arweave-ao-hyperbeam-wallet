import { useEffect, useState } from "react";
import type { RuntimePort } from "@gleam/core";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import type { BiometricAvailability, BiometricUnlockPort } from "../../../app-platform/types";
import { BiometricError, biometryLabel, biometryTitle } from "../../../biometrics/biometrics";
import { BiometricIcon } from "../../unlock/src/UnlockScreen";

type Notice = { text: string; tone: "muted" | "error" };

type Unavailable = Extract<BiometricAvailability, { available: false }>;

type SectionState =
  | { kind: "loading" }
  | {
      kind: "ready";
      availability: BiometricAvailability;
      enrolled: boolean;
      /** The password form is open. */
      setUp: boolean;
      phase: "idle" | "checking" | "enrolling" | "removing";
      passwordError?: string;
      notice?: Notice;
    };

const UNAVAILABLE_COPY: Record<Unavailable["reason"], string> = {
  "not-enrolled": "Set up Face ID or a fingerprint in your device settings to unlock Gleam with it.",
  "no-passcode": "Set a passcode on your device first, then add Face ID or a fingerprint.",
  unavailable: "This device can't unlock Gleam with biometrics.",
};

/**
 * Biometric unlock in Lock & unlock. The password is checked before the
 * OS stores it, so a typo never leaves an item that can't open the vault.
 */
export function BiometricSection({ runtime, biometrics }: { runtime: RuntimePort; biometrics: BiometricUnlockPort }) {
  const [state, setState] = useState<SectionState>({ kind: "loading" });
  const [password, setPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // A stored password stays removable when the device can't check
      // biometrics now, as after removing every fingerprint or a lockout.
      const [availability, enrolled] = await Promise.all([
        biometrics.availability().catch((): BiometricAvailability => ({ available: false, reason: "unavailable" })),
        biometrics.isEnrolled().catch(() => false),
      ]);
      if (!cancelled) setState({ kind: "ready", availability, enrolled, setUp: false, phase: "idle" });
    })();
    return () => {
      cancelled = true;
    };
  }, [biometrics]);

  const kind = state.kind === "ready" && state.availability.available ? state.availability.kind : "biometrics";
  const title = biometryTitle(kind);
  const label = biometryLabel(kind);

  const handleEnrol = async () => {
    if (state.kind !== "ready") return;
    const ready = state;
    setState({ ...ready, phase: "checking", passwordError: undefined, notice: undefined });
    try {
      await runtime.send<{ password: string }, void>({ type: "checkVaultPassword", payload: { password } });
    } catch (error) {
      setState({ ...ready, phase: "idle", passwordError: error instanceof Error ? error.message : String(error) });
      return;
    }
    setState({ ...ready, phase: "enrolling", passwordError: undefined, notice: undefined });
    try {
      await biometrics.enrol(password);
    } catch (error) {
      setState({
        ...ready,
        phase: "idle",
        notice:
          error instanceof BiometricError && error.reason === "cancelled"
            ? { text: `${title} cancelled. Try again when you're ready.`, tone: "muted" }
            : { text: `Couldn't turn on ${label} unlock. Try again.`, tone: "error" },
      });
      return;
    }
    setPassword("");
    setState({ ...ready, enrolled: true, setUp: false, phase: "idle" });
  };

  const handleRemove = async () => {
    if (state.kind !== "ready") return;
    const ready = state;
    setState({ ...ready, phase: "removing", notice: undefined });
    try {
      await biometrics.remove();
      setState({ ...ready, enrolled: false, phase: "idle" });
    } catch (error) {
      setState({ ...ready, phase: "idle", notice: { text: error instanceof Error ? error.message : String(error), tone: "error" } });
    }
  };

  const busy = state.kind === "ready" && state.phase !== "idle";

  return (
    <div className="pb-10 phone:pb-8">
      <div className="border-b border-line pb-3.5 text-label font-semibold uppercase phone:border-b-0 phone:pb-1 tracking-[0.04em] text-muted">
        {title}
      </div>
      {state.kind === "loading" ? (
        <SkeletonRow />
      ) : state.enrolled ? (
        <div className="flex items-center gap-3 py-3.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-mist text-foreground">
            <BiometricIcon />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label font-semibold text-foreground">Unlock with {label} is on</span>
            <span className="text-caption text-muted">
              {state.availability.available
                ? "Your password still works too"
                : "This device can't check biometrics right now. Use your password."}
            </span>
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRemove()}
            className="rounded-md px-2 py-1 text-label font-medium text-muted hover:bg-mist hover:text-foreground disabled:opacity-60"
          >
            {state.phase === "removing" ? "Turning off…" : "Turn off"}
          </button>
        </div>
      ) : !state.availability.available ? (
        <p className="py-3.5 text-caption text-muted">{UNAVAILABLE_COPY[state.availability.reason]}</p>
      ) : state.setUp ? (
        <form
          className="flex flex-col gap-4 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && password.length > 0) void handleEnrol();
          }}
        >
          <PasswordField
            label="Password"
            placeholder="Enter your Gleam password"
            autoFocus
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            errorMessage={state.passwordError}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPassword("");
                setState({ ...state, setUp: false, passwordError: undefined, notice: undefined });
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || password.length === 0} aria-busy={busy} className="flex-1">
              {state.phase === "checking" ? "Checking…" : state.phase === "enrolling" ? `Waiting for ${label}…` : "Turn on"}
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setState({ ...state, setUp: true, notice: undefined })}
          className="flex w-full items-center gap-3 py-3.5 text-left hover:bg-mist"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-mist text-foreground">
            <BiometricIcon />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label font-semibold text-foreground">Unlock with {label}</span>
            <span className="text-caption text-muted">Use {label} instead of typing your password</span>
          </span>
        </button>
      )}
      {state.kind === "ready" && state.notice ? (
        <p
          role={state.notice.tone === "error" ? "alert" : "status"}
          className={state.notice.tone === "error" ? "pt-1 text-caption text-warning" : "pt-1 text-caption text-muted"}
        >
          {state.notice.text}
        </p>
      ) : null}
      {state.kind === "ready" && state.setUp && !state.enrolled ? (
        <p className="pt-2.5 text-caption leading-relaxed text-faint">
          Your password still unlocks Gleam. Keep it: you&apos;ll need it if your {label} settings change.
        </p>
      ) : null}
    </div>
  );
}
