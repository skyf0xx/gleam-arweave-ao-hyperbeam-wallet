import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  ApprovalRequest,
  DeviceSigningRequest,
  RecipientAssessment,
  RuntimePort,
  SecurityPhrase,
  ThemeSettings,
  WalletState,
} from "@gleam/core";
import type { ApprovalShown, AttestationCheck } from "@gleam/messaging/src/protocol.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import { SecurityPhraseMark } from "@gleam/ui/src/components/security-phrase/index.ts";
import { securityPhraseIconSvg } from "../security-phrase-icon";
import {
  AddressIdentityProvider,
  loadAddressIdentityKey,
  makeAddressIdentity,
  NO_ADDRESS_IDENTITY_KEY,
  type AddressIdentityKey,
} from "../address-identity";
import { OnboardingView } from "../screens/onboarding/index.tsx";
import { UnlockView } from "../screens/unlock/index.tsx";
import { AddTokenScreen } from "./AddTokenScreen";
import { AwaitingDeviceView } from "./AwaitingDeviceView";
import { usePlatform } from "../app-platform/context";
import { ConnectionRequestScreen } from "./ConnectionRequestScreen";
import { ScanAttestationResult, ScanAttestationScreen } from "./ScanAttestationScreen";
import { SigningApprovalScreen } from "./SigningApprovalScreen";

/**
 * The approval window's top-level state machine: loads the pending
 * `ApprovalRequest` for `requestId` via `getApproval`, then renders
 * `ConnectionRequestScreen`, `AddTokenScreen` or `SigningApprovalScreen`
 * depending on `request.kind`. The dApp keeps waiting while the window first runs
 * onboarding (no wallet yet) or unlock (wallet locked) in place, and the
 * request shows once that's done.
 *
 * The `RuntimePort` and the device panels come from `AppPlatform`; the
 * `runtime` prop replaces the former, which tests use to stub the background.
 *
 * Theme: this window never mounts `<App>` (`approval/index.tsx`'s own
 * doc comment — a genuinely separate root, its own state machine), so
 * `App.tsx`'s `applyTheme`/`data-theme` wiring never runs here. Mirrors
 * `applyTheme` exactly (same fetch, same light fallback on any failure,
 * including the dispatcher not yet registering the method) so the
 * two surfaces apply identically instead of reimplementing the read
 * differently.
 *
 * A scan attestation from the Gleam site renders `ScanAttestationScreen`,
 * and its window stays open after signing to show the points it earned
 * or why it was refused.
 *
 * A hardware wallet's request goes on to `AwaitingDeviceView` once
 * approved (or straight there if the window reopens on it), which drives
 * the device with the `DeviceSignPanel` for the wallet's method.
 */
export interface ApprovalRootProps {
  requestId: string | null;
  runtime?: RuntimePort;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "no-wallet"; runtime: RuntimePort; request: ApprovalRequest }
  | { kind: "locked"; runtime: RuntimePort; request: ApprovalRequest }
  | { kind: "ready"; runtime: RuntimePort; request: ApprovalRequest; assessment: RecipientAssessment | null }
  | { kind: "awaiting-device"; runtime: RuntimePort; request: ApprovalRequest; device: DeviceSigningRequest }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string }
  | { kind: "attested"; result: SiteAttestResponse }
  | { kind: "failed"; message: string };

function isShown(value: unknown): value is ApprovalShown {
  return typeof value === "object" && value !== null && (value as { shown?: unknown }).shown === "scanAttestation";
}

/**
 * The wallet that must be unlocked: the one a scan attestation was opened
 * for, which stays its signer even if the user switches wallets, or else
 * the active wallet. Unlock opens every wallet that shares the vault
 * password.
 */
function needsUnlock(state: WalletState, request: ApprovalRequest): boolean {
  const unlocked = state.session?.unlockedWalletIds ?? [];
  const walletId = request.preview.kind === "scanAttestation" ? request.preview.walletId : state.activeWalletId;
  if (walletId === null) return unlocked.length === 0;
  return !unlocked.includes(walletId);
}

/** Best effort: a failed lookup shows no recipient warning, and the generic one still shows. */
async function assessRecipientFor(
  runtime: RuntimePort,
  request: ApprovalRequest,
  walletId: string | null,
): Promise<RecipientAssessment | null> {
  const preview = request.preview;
  if (preview.kind === "connect" || preview.kind === "addToken" || preview.kind === "scanAttestation") return null;
  if (!preview.recipient || !walletId) return null;
  try {
    const assessment = await runtime.send<{ walletId: string; recipient: string }, RecipientAssessment | undefined>({
      type: "assessRecipient",
      payload: { walletId, recipient: preview.recipient },
    });
    return assessment ?? null;
  } catch {
    return null;
  }
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function ApprovalRoot({ requestId, runtime: runtimeProp }: ApprovalRootProps) {
  const platform = usePlatform();
  const devicePanels = platform.hardwareWallets.signPanels;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [theme, setTheme] = useState<ThemeSettings["theme"]>("light");
  const [securityPhrase, setSecurityPhrase] = useState<{ phrase: SecurityPhrase; icon: string } | null>(null);
  const [runtime, setRuntime] = useState<RuntimePort | null>(runtimeProp ?? platform.runtime);
  const [identityKey, setIdentityKey] = useState<AddressIdentityKey>(NO_ADDRESS_IDENTITY_KEY);
  const addressIdentity = useMemo(
    () => makeAddressIdentity(identityKey, () => void (runtime && loadAddressIdentityKey(runtime).then(setIdentityKey))),
    [identityKey, runtime],
  );

  const loadSecurityPhrase = async (runtime: RuntimePort) => {
    try {
      const phrase = await runtime.send<void, SecurityPhrase | null>({ type: "getSecurityPhrase", payload: undefined });
      setSecurityPhrase(phrase ? { phrase, icon: securityPhraseIconSvg(phrase.word) } : null);
    } catch {
      setSecurityPhrase(null);
    }
  };

  const applyTheme = async (runtime: RuntimePort) => {
    try {
      const settings = await runtime.send<void, ThemeSettings>({
        type: "getThemePreference",
        payload: undefined,
      });
      setTheme(settings.theme);
    } catch {
      setTheme("light");
    }
  };

  const load = async (runtime: RuntimePort, id: string) => {
    try {
      // The request is read first so a stale window says so instead of
      // asking the user to set up or unlock a wallet for nothing.
      const request = await runtime.send<{ requestId: string }, ApprovalRequest>({
        type: "getApproval",
        payload: { requestId: id },
      });
      const walletState = await runtime.send<{ recordActivity: boolean }, WalletState>({ type: "getState", payload: { recordActivity: false } });
      if (request.device) {
        setState({ kind: "awaiting-device", runtime, request, device: request.device });
      } else if (walletState.wallets.length === 0) {
        setState({ kind: "no-wallet", runtime, request });
      } else if (needsUnlock(walletState, request)) {
        setState({ kind: "locked", runtime, request });
      } else {
        const assessment = await assessRecipientFor(runtime, request, walletState.activeWalletId);
        setState({ kind: "ready", runtime, request, assessment });
      }
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!requestId) {
        setState({ kind: "error", message: "This approval window has no request to show." });
        return;
      }
      try {
        const runtime = runtimeProp ?? platform.runtime;
        if (cancelled) return;
        setRuntime(runtime);
        await Promise.all([
          load(runtime, requestId),
          applyTheme(runtime),
          loadSecurityPhrase(runtime),
          loadAddressIdentityKey(runtime).then(setIdentityKey),
        ]);
      } catch (error) {
        if (cancelled) return;
        setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const rejectRequest = async (runtime: RuntimePort, request: ApprovalRequest) => {
    try {
      await runtime.send<{ requestId: string; approved: boolean }, void>({
        type: "resolveApproval",
        payload: { requestId: request.requestId, approved: false },
      });
    } finally {
      setState({ kind: "done", message: "Request rejected." });
    }
  };

  let content: ReactNode;

  if (state.kind === "loading") {
    content = <CenteredMessage text="Loading…" />;
  } else if (state.kind === "error") {
    content = <CenteredMessage text={state.message} />;
  } else if (state.kind === "done") {
    content = <CenteredMessage text={state.message} />;
  } else if (state.kind === "attested") {
    content = <ScanAttestationResult result={state.result} onClose={() => window.close()} />;
  } else if (state.kind === "failed") {
    content = <CenteredMessage text={state.message} tone="warning" />;
  } else if (state.kind === "no-wallet") {
    content = (
      <OnboardingView
        runtime={state.runtime}
        onComplete={() => void load(state.runtime, state.request.requestId)}
      />
    );
  } else if (state.kind === "locked") {
    content = (
      <UnlockView
        runtime={state.runtime}
        tagline={`Unlock to review ${hostnameOf(state.request.origin)}'s request`}
        onUnlocked={() => void load(state.runtime, state.request.requestId)}
        // A reset rejects every pending request, this one included.
        onResetComplete={() => setState({ kind: "done", message: "Gleam was reset. The request was rejected." })}
      />
    );
  } else if (state.kind === "awaiting-device") {
    const { runtime, request, device } = state;
    const Panel = devicePanels?.[device.method];
    content = Panel ? (
      <AwaitingDeviceView
        origin={request.origin}
        device={device}
        Panel={Panel}
        token={
          request.preview.kind !== "connect" &&
          request.preview.kind !== "addToken" &&
          request.preview.kind !== "scanAttestation" &&
          request.preview.token !== null
            ? {
                processId: request.preview.token,
                denomination: request.preview.tokenDenomination,
                ticker: request.preview.tokenTicker,
              }
            : undefined
        }
        onSubmit={async (signatures) => {
          const shown = await runtime.send<{ requestId: string; signatures: string[] }, ApprovalShown | undefined>({
            type: "submitDeviceSignature",
            payload: { requestId: request.requestId, signatures },
          });
          setState(isShown(shown) ? { kind: "attested", result: shown.result } : { kind: "done", message: "Signed." });
        }}
        onCancel={() => void rejectRequest(runtime, request)}
        onActivity={() =>
          runtime.send<{ requestId: string }, { deadline: number }>({
            type: "deviceActivity",
            payload: { requestId: request.requestId },
          })
        }
      />
    ) : (
      <CenteredMessage text="This window can't reach a hardware wallet." tone="warning" />
    );
  } else {
    const { runtime, request, assessment } = state;

    const handleReject = () => rejectRequest(runtime, request);

    // A failed approval has already rejected the dApp and dropped the
    // request, so there's nothing to retry: show the error and stop.
    const handleApprove = async (doneMessage: string, failurePrefix: string) => {
      try {
        const next = await runtime.send<{ requestId: string; approved: boolean }, ApprovalRequest | ApprovalShown | undefined>({
          type: "resolveApproval",
          payload: { requestId: request.requestId, approved: true },
        });
        if (isShown(next)) {
          setState({ kind: "attested", result: next.result });
          return;
        }
        if (next?.device) {
          setState({ kind: "awaiting-device", runtime, request: next, device: next.device });
          return;
        }
        setState({ kind: "done", message: doneMessage });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setState({ kind: "failed", message: `${failurePrefix}: ${reason}` });
      }
    };

    if (request.preview.kind === "connect") {
      const preview = request.preview;
      content = (
        <ConnectionRequestScreen
          origin={request.origin}
          preview={preview}
          onReject={() => void handleReject()}
          onGrant={() => void handleApprove("Grant approved.", "Couldn't connect")}
        />
      );
    } else if (request.preview.kind === "addToken") {
      content = (
        <AddTokenScreen
          origin={request.origin}
          preview={request.preview}
          onReject={() => void handleReject()}
          onAdd={() => handleApprove("Token added.", "Couldn't add the token")}
        />
      );
    } else if (request.preview.kind === "scanAttestation") {
      content = (
        <ScanAttestationScreen
          runtime={runtime}
          origin={request.origin}
          preview={request.preview}
          onReject={() => void handleReject()}
          onCheck={() =>
            runtime.send<{ requestId: string }, AttestationCheck>({
              type: "checkScanAttestation",
              payload: { requestId: request.requestId },
            })
          }
          onSign={() => handleApprove("Signed.", "Couldn't sign the attestation")}
        />
      );
    } else {
      const signingPreview = request.preview;
      content = (
        <SigningApprovalScreen
          origin={request.origin}
          preview={signingPreview}
          assessment={assessment}
          onReject={() => void handleReject()}
          onSign={() => handleApprove("Signed.", "Signing failed")}
        />
      );
    }
  }

  // The unlock screen shows the phrase itself; the request screens get it
  // above their own header.
  const showSecurityPhrase = securityPhrase !== null && (state.kind === "ready" || state.kind === "awaiting-device");

  return (
    <AddressIdentityProvider value={addressIdentity}>
      <div data-theme={theme === "dark" ? "dark" : undefined} className="min-h-full">
        {showSecurityPhrase ? (
          <div className="flex justify-center px-6 pt-3">
            <SecurityPhraseMark phrase={securityPhrase.phrase} iconSvg={securityPhrase.icon} />
          </div>
        ) : null}
        {content}
      </div>
    </AddressIdentityProvider>
  );
}

function CenteredMessage({ text, tone = "muted" }: { text: string; tone?: "muted" | "warning" }) {
  if (tone === "warning") {
    return (
      <div role="alert" className="flex min-h-full items-center justify-center p-6 text-center text-sm text-warning">
        {text}
      </div>
    );
  }
  return (
    <div className="flex min-h-full items-center justify-center p-6 text-center text-sm text-[#737373]">
      {text}
    </div>
  );
}
