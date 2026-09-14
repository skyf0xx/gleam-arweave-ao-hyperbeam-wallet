import { useState } from "react";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { Welcome } from "./Welcome";
import { CreatePassword } from "./CreatePassword";
import { Backup } from "./Backup";
import { Import } from "./Import";

/**
 * Onboarding view module (`entrypoints/popup/onboarding/`) — a WXT
 * folder per the browser-extension blueprint's naming rule, but not
 * itself a registered WXT entrypoint (ARCHITECTURE.md §1.3: the popup is
 * one entrypoint with a validated view-name string). `App.tsx` (owned by
 * `scaffold`'s scope, not this layer's) is expected to import
 * `OnboardingView` and mount it when its view-switch selects
 * `"onboarding"` — see this task's final report for the scope gap this
 * leaves (nothing in `scaffold`'s or this layer's own ALLOWED SCOPE
 * covers writing that switch statement).
 *
 * Internal step state only — no router, matching ARCHITECTURE.md §1.3's
 * "validated view-name string, not a router library" even one level
 * down inside a single view.
 */
type Step =
  | { kind: "welcome" }
  | { kind: "create-password" }
  | { kind: "backup"; keyfileContents: string; walletName: string }
  | { kind: "import" }
  | { kind: "import-password"; jwk: unknown };

export interface OnboardingViewProps {
  runtime: RuntimePort;
  onComplete: () => void;
}

const DEFAULT_WALLET_NAME = "Wallet 1";

export function OnboardingView({ runtime, onComplete }: OnboardingViewProps) {
  const [step, setStep] = useState<Step>({ kind: "welcome" });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>();

  const handleCreatePassword = async (password: string) => {
    setSubmitting(true);
    setServerError(undefined);
    try {
      const summary = await runtime.send<{ name: string; password: string }, WalletSummary>({
        type: "createWallet",
        payload: { name: DEFAULT_WALLET_NAME, password },
      });
      // `exportWallet` re-decrypts the just-created envelope rather than
      // this view module ever holding the plaintext JWK itself — the
      // password already left this component's state by this point.
      const jwk = await runtime.send<{ walletId: string; password: string }, unknown>({
        type: "exportWallet",
        payload: { walletId: summary.id, password },
      });
      setStep({
        kind: "backup",
        keyfileContents: JSON.stringify(jwk),
        walletName: summary.name,
      });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleImportPassword = async (jwk: unknown, password: string) => {
    setSubmitting(true);
    setServerError(undefined);
    try {
      await runtime.send({
        type: "importWallet",
        payload: { jwk, name: DEFAULT_WALLET_NAME, password },
      });
      onComplete();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  switch (step.kind) {
    case "welcome":
      return (
        <Welcome
          onCreate={() => setStep({ kind: "create-password" })}
          onImport={() => setStep({ kind: "import" })}
        />
      );

    case "create-password":
      return (
        <CreatePassword
          onBack={() => setStep({ kind: "welcome" })}
          onSubmit={handleCreatePassword}
          submitting={submitting}
          serverError={serverError}
        />
      );

    case "backup":
      return (
        <Backup
          onBack={() => setStep({ kind: "welcome" })}
          keyfileContents={step.keyfileContents}
          onDownload={() => downloadKeyfile(step.keyfileContents, step.walletName)}
          onCopy={() => void navigator.clipboard?.writeText(step.keyfileContents)}
          onContinue={onComplete}
        />
      );

    case "import":
      return (
        <Import
          onBack={() => setStep({ kind: "welcome" })}
          onValidJWK={(jwk) => setStep({ kind: "import-password", jwk })}
        />
      );

    case "import-password":
      return (
        <CreatePassword
          title="Import a wallet"
          onBack={() => setStep({ kind: "import" })}
          onSubmit={(password) => handleImportPassword(step.jwk, password)}
          submitting={submitting}
          serverError={serverError}
        />
      );
  }
}

function downloadKeyfile(contents: string, walletName: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${walletName.replace(/\s+/g, "-").toLowerCase()}-arweave-keyfile.json`;
  link.click();
  URL.revokeObjectURL(url);
}
