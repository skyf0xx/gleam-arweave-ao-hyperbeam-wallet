import { useEffect, useState } from "react";
import type { RuntimePort } from "@gleam/core";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { IconRow, SettingsSectionTitle } from "@gleam/ui/src/primitives/setting-rows.tsx";
import type { BiometricAvailability, BiometricUnlockPort } from "../../../app-platform/types";
import { BiometricError, biometryLabel, biometryTitle } from "../../../biometrics/biometrics";
import { BiometricIcon, Spinner } from "../../unlock/src/UnlockScreen";
import { useT, type MessageKey } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { ButtonPair } from "@gleam/ui/src/primitives/button-pair.tsx";

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

const UNAVAILABLE_KEYS = {
  "not-enrolled": "lockSettings.bioNotEnrolled",
  "no-passcode": "lockSettings.bioNoPasscode",
  unavailable: "lockSettings.bioUnavailable",
} as const satisfies Record<Unavailable["reason"], MessageKey>;

/**
 * Biometric unlock in Lock & unlock. The password is checked before the
 * OS stores it, so a typo never leaves an item that can't open the vault.
 */
export function BiometricSection({ runtime, biometrics }: { runtime: RuntimePort; biometrics: BiometricUnlockPort }) {
  const t = useT();
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
      setState({ ...ready, phase: "idle", passwordError: errorText(error) });
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
            ? { text: t("lockSettings.bioCancelled", { title }), tone: "muted" }
            : { text: t("lockSettings.bioTurnOnFailed", { label }), tone: "error" },
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
      setState({ ...ready, phase: "idle", notice: { text: errorText(error), tone: "error" } });
    }
  };

  const busy = state.kind === "ready" && state.phase !== "idle";

  return (
    <div className="pb-10 phone:pb-8">
      <SettingsSectionTitle>
        {title}
      </SettingsSectionTitle>
      {state.kind === "loading" ? (
        <SkeletonRow />
      ) : state.enrolled ? (
        <IconRow
          icon={<BiometricIcon />}
          title={t("lockSettings.bioOn", { label })}
          description={state.availability.available ? t("lockSettings.bioPasswordStillWorks") : t("lockSettings.bioCantCheck")}
          trailing={
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRemove()}
              className="rounded-md px-2 py-1 text-label font-medium text-muted hover:bg-hover hover:text-foreground disabled:opacity-60"
            >
              {state.phase === "removing" ? t("lockSettings.turningOff") : t("lockSettings.turnOff")}
            </button>
          }
        />
      ) : !state.availability.available ? (
        <p className="py-3.5 text-caption text-muted">{t(UNAVAILABLE_KEYS[state.availability.reason])}</p>
      ) : state.setUp ? (
        <form
          className="flex flex-col gap-4 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && password.length > 0) void handleEnrol();
          }}
        >
          <PasswordField
            label={t("lockSettings.password")}
            placeholder={t("lockSettings.passwordPlaceholder")}
            autoFocus
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            errorMessage={state.passwordError}
          />
          <ButtonPair
            cancelLabel={t("lockSettings.cancel")}
            onCancel={() => {
              setPassword("");
              setState({ ...state, setUp: false, passwordError: undefined, notice: undefined });
            }}
            cancelDisabled={busy}
            confirmType="submit"
            confirmDisabled={busy || password.length === 0}
            confirmBusy={busy}
            confirmLabel={
              state.phase === "checking" ? (
                t("lockSettings.checking")
              ) : state.phase === "enrolling" ? (
                // The full text would wrap on a phone; screen readers still get it.
                <>
                  <Spinner />
                  <span aria-hidden="true">{t("lockSettings.waiting")}</span>
                  <span className="sr-only">{t("lockSettings.waitingFor", { label })}</span>
                </>
              ) : (
                t("lockSettings.turnOn")
              )
            }
          />
        </form>
      ) : (
        <IconRow
          icon={<BiometricIcon />}
          title={t("lockSettings.bioUnlockWith", { label })}
          description={t("lockSettings.bioUseInstead", { label })}
          onClick={() => setState({ ...state, setUp: true, notice: undefined })}
        />
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
          {t("lockSettings.bioKeepPassword", { label })}
        </p>
      ) : null}
    </div>
  );
}
