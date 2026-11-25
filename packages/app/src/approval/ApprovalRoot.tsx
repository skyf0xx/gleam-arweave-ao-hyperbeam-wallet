import { useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hostnameOf } from "../hostname";
import { useT, type MessageKey } from "../i18n";
import { LocalizedRoot } from "../i18n/LocalizedRoot";
import type { ApprovalRequest, RuntimePort, SecurityPhrase, ThemeSettings, WalletState } from "@gleam/core";
import type { ApprovalShown, AttestationCheck } from "@gleam/messaging/src/protocol.ts";
import { SecurityPhraseMark } from "@gleam/ui/src/components/security-phrase/index.ts";
import { securityPhraseIconSvg } from "../security-phrase-icon";
import { loadSecurityPhrase } from "../security-phrase";
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
import { DEVICE_NAMES } from "./device-panels";
import { usePlatform } from "../app-platform/context";
import { forgetQueryCache } from "../query-cache/sweep";
import { ConnectionRequestScreen } from "./ConnectionRequestScreen";
import { ScanAttestationResult, ScanAttestationScreen } from "./ScanAttestationScreen";
import { SigningApprovalScreen } from "./SigningApprovalScreen";
import { applyStoredTheme, themeAttribute } from "../theme";
import { LoadSignedDataProvider } from "./SignedDataText";
import { errorText } from "../i18n/errors";
import { assessRecipientFor, isShown, needsUnlock, tokensOf, type LoadState } from "./approval-load";
import { CenteredMessage } from "./CenteredMessage";
import { useApprovalTransferContext } from "../transfer-review/useApprovalTransferContext";
import { INPUT_ARM_DELAY_MS, useInputArmed } from "./input-arming";
import { InputArmedContext } from "./ArmingLabel";

/**
 * The approval UI's top-level state machine, in a window or a sheet: loads the pending
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
  /** Closes the surface the request shows in, once the user is finished with it. Defaults to closing the window. */
  onClose?: () => void;
  /** How long a review screen waits before it accepts clicks (`input-arming.ts`). */
  armDelayMs?: number;
}

export function ApprovalRoot(props: ApprovalRootProps) {
  // A short-lived window: a failed read shows its error rather than retrying behind it.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <LocalizedRoot>
      <QueryClientProvider client={queryClient}>
        <ApprovalRootContent {...props} />
      </QueryClientProvider>
    </LocalizedRoot>
  );
}

function ApprovalRootContent({
  requestId,
  runtime: runtimeProp,
  onClose = () => window.close(),
  armDelayMs = INPUT_ARM_DELAY_MS,
}: ApprovalRootProps) {
  const platform = usePlatform();
  const t = useT();
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

  const applySecurityPhrase = async (runtime: RuntimePort) => {
    const phrase = await loadSecurityPhrase(runtime);
    setSecurityPhrase(phrase ? { phrase, icon: securityPhraseIconSvg(phrase.word) } : null);
  };

  const applyTheme = (runtime: RuntimePort) => applyStoredTheme(runtime, setTheme);

  const load = async (runtime: RuntimePort, id: string) => {
    try {
      // The request is read first so a stale window says so instead of
      // asking the user to set up or unlock a wallet for nothing.
      const request = await runtime.send<{ requestId: string }, ApprovalRequest>({
        type: "getApproval",
        payload: { requestId: id },
      });
      const walletState = await runtime.send<{ recordActivity: boolean }, WalletState>({ type: "getState", payload: { recordActivity: false } });
      // The review wallet is the one the request signs or sends from,
      // pinned when it was made — not the wallet that happens to be active
      // when the window loads. A wallet-origin transfer survives a switch,
      // so the active wallet can be a different one from the sender, and
      // the review would show the wrong wallet as From. Without a pinned
      // wallet (connect, addToken) the active wallet is the review wallet,
      // as before; a pinned wallet that no longer exists leaves no From,
      // and the recipient assessment is skipped with it.
      const reviewWalletId = request.signingWallet?.id ?? walletState.activeWalletId;
      const wallet = walletState.wallets.find((candidate) => candidate.id === reviewWalletId) ?? null;
      if (request.device) {
        const device = request.device;
        const signer = walletState.wallets.find((candidate) => candidate.address === device.address) ?? wallet;
        setState({ kind: "awaiting-device", runtime, request, device, wallet: signer });
      } else if (walletState.wallets.length === 0) {
        setState({ kind: "no-wallet", runtime, request });
      } else if (needsUnlock(walletState, request)) {
        setState({ kind: "locked", runtime, request });
      } else {
        const assessment = await assessRecipientFor(runtime, request, wallet?.id ?? null);
        setState({ kind: "ready", runtime, request, assessment, wallet });
      }
    } catch (error) {
      setState({ kind: "error", message: errorText(error) });
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!requestId) {
        setState({ kind: "error", message: t("approval.noRequest") });
        return;
      }
      try {
        const runtime = runtimeProp ?? platform.runtime;
        if (cancelled) return;
        setRuntime(runtime);
        await Promise.all([
          load(runtime, requestId),
          applyTheme(runtime),
          applySecurityPhrase(runtime),
          loadAddressIdentityKey(runtime).then(setIdentityKey),
        ]);
      } catch (error) {
        if (cancelled) return;
        setState({ kind: "error", message: errorText(error) });
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
      setState({ kind: "done", message: t("approval.requestRejected") });
    }
  };

  const reviewing = state.kind === "ready" || state.kind === "awaiting-device" ? state : null;
  // Clicks on a review screen count only once it has been on screen and
  // focused for a moment: the site picks when this window opens.
  const armed = useInputArmed(`${state.kind}:${requestId ?? ""}`, armDelayMs);
  const guardClicks = reviewing !== null && !armed;
  const transferContext = useApprovalTransferContext(
    reviewing?.runtime ?? null,
    reviewing?.kind === "awaiting-device" ? reviewing.device.address : (reviewing?.wallet?.address ?? null),
    reviewing ? tokensOf(reviewing.request) : [],
  );

  let content: ReactNode;

  if (state.kind === "loading") {
    content = <CenteredMessage text={t("approval.loading")} />;
  } else if (state.kind === "error") {
    content = <CenteredMessage text={state.message} />;
  } else if (state.kind === "done") {
    content = <CenteredMessage text={state.message} />;
  } else if (state.kind === "attested") {
    content = <ScanAttestationResult result={state.result} onClose={onClose} />;
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
        tagline={t("approval.unlockToReview", { host: hostnameOf(state.request.origin) })}
        onUnlocked={() => void load(state.runtime, state.request.requestId)}
        // A reset rejects every pending request, this one included.
        onResetComplete={() => {
          void forgetQueryCache(platform.queryCache.clear());
          setState({ kind: "done", message: t("approval.resetDone") });
        }}
      />
    );
  } else if (state.kind === "awaiting-device") {
    const { runtime, request, device, wallet } = state;
    const Panel = devicePanels?.[device.method];
    content = Panel ? (
      <AwaitingDeviceView
        origin={request.origin}
        siteIcon={request.siteIcon ?? null}
        device={device}
        Panel={Panel}
        from={{ name: wallet?.address === device.address ? wallet.name : null, address: device.address }}
        context={transferContext}
        collectible={
          request.preview.kind !== "connect" &&
          request.preview.kind !== "addToken" &&
          request.preview.kind !== "scanAttestation"
            ? request.preview.collectible
            : undefined
        }
        nameTarget={
          request.preview.kind !== "connect" &&
          request.preview.kind !== "addToken" &&
          request.preview.kind !== "scanAttestation"
            ? request.preview.nameTarget
            : undefined
        }
        token={
          request.preview.kind !== "connect" &&
          request.preview.kind !== "addToken" &&
          request.preview.kind !== "scanAttestation" &&
          request.preview.token !== null
            ? {
                processId: request.preview.token,
                denomination: request.preview.tokenDenomination,
                ticker: request.preview.tokenTicker,
                ...(request.preview.tokenImpersonating ? { impersonating: true as const } : {}),
              }
            : undefined
        }
        onSubmit={async (signatures) => {
          const shown = await runtime.send<{ requestId: string; signatures: string[] }, ApprovalShown | undefined>({
            type: "submitDeviceSignature",
            payload: { requestId: request.requestId, signatures },
          });
          setState(isShown(shown) ? { kind: "attested", result: shown.result } : { kind: "done", message: t("approval.signed") });
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
      <CenteredMessage text={t("approval.cantReachDevice", { device: DEVICE_NAMES[device.method] })} tone="warning" />
    );
  } else {
    const { runtime, request, assessment, wallet } = state;

    const handleReject = () => rejectRequest(runtime, request);

    // A failed approval has already rejected the dApp and dropped the
    // request, so there's nothing to retry: show the error and stop.
    const handleApprove = async (doneKey: MessageKey, failureKey: MessageKey) => {
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
          const signer = wallet?.address === next.device.address ? wallet : null;
          setState({ kind: "awaiting-device", runtime, request: next, device: next.device, wallet: signer });
          return;
        }
        setState({ kind: "done", message: t(doneKey) });
      } catch (error) {
        const reason = errorText(error);
        setState({ kind: "failed", message: t(failureKey, { reason }) });
      }
    };

    if (request.preview.kind === "connect") {
      const preview = request.preview;
      content = (
        <ConnectionRequestScreen
          origin={request.origin}
          preview={preview}
          wallet={wallet ? { name: wallet.name, address: wallet.address } : null}
          onReject={() => void handleReject()}
          onGrant={() => void handleApprove("approval.grantApproved", "approval.couldntConnect")}
        />
      );
    } else if (request.preview.kind === "addToken") {
      content = (
        <AddTokenScreen
          origin={request.origin}
          siteIcon={request.siteIcon ?? null}
          preview={request.preview}
          onReject={() => void handleReject()}
          onAdd={() => handleApprove("approval.tokenAdded", "approval.couldntAddToken")}
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
          onSign={() => handleApprove("approval.signed", "approval.couldntSignAttestation")}
        />
      );
    } else {
      const signingPreview = request.preview;
      content = (
        <LoadSignedDataProvider
          value={async (index) =>
            (
              await runtime.send<{ requestId: string; index?: number }, { text: string | null }>({
                type: "getApprovalData",
                payload: { requestId: request.requestId, ...(index === undefined ? {} : { index }) },
              })
            ).text
          }
        >
        <SigningApprovalScreen
          origin={request.origin}
          siteIcon={request.siteIcon ?? null}
          preview={signingPreview}
          assessment={assessment}
          from={wallet ? { name: wallet.name, address: wallet.address } : null}
          context={transferContext}
          onReject={() => void handleReject()}
          onSign={() => handleApprove("approval.signed", "approval.signingFailed")}
        />
        </LoadSignedDataProvider>
      );
    }
  }

  // The unlock screen shows the phrase itself; the request screens get it
  // above their own header.
  const showSecurityPhrase = securityPhrase !== null && (state.kind === "ready" || state.kind === "awaiting-device");

  return (
    <AddressIdentityProvider value={addressIdentity}>
      <div data-theme={themeAttribute(theme)} className="min-h-full bg-background text-foreground">
        {showSecurityPhrase ? (
          <div className="flex justify-center px-6 pt-3">
            <SecurityPhraseMark phrase={securityPhrase.phrase} iconSvg={securityPhrase.icon} />
          </div>
        ) : null}
        <div
          className="contents"
          data-input-armed={reviewing ? String(armed) : undefined}
          onClickCapture={(event) => {
            if (!guardClicks) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <InputArmedContext.Provider value={!guardClicks}>{content}</InputArmedContext.Provider>
        </div>
      </div>
    </AddressIdentityProvider>
  );
}
