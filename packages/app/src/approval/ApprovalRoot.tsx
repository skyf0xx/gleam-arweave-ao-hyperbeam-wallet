import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useT, type MessageKey } from "../i18n";
import { LocalizedRoot } from "../i18n/LocalizedRoot";
import type {
  ApprovalRequest,
  DeviceSigningRequest,
  RecipientAssessment,
  RuntimePort,
  SecurityPhrase,
  ThemeSettings,
  WalletState,
  WalletSummary,
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
import { DEVICE_NAMES } from "./device-panels";
import { usePlatform } from "../app-platform/context";
import { forgetQueryCache } from "../query-cache/sweep";
import { ConnectionRequestScreen } from "./ConnectionRequestScreen";
import { ScanAttestationResult, ScanAttestationScreen } from "./ScanAttestationScreen";
import { SigningApprovalScreen } from "./SigningApprovalScreen";
import { errorText } from "../i18n/errors";
import { recipientsOf, transferRequestFromPreview } from "../transfer-review/model";
import { useApprovalTransferContext } from "../transfer-review/useApprovalTransferContext";
import { INPUT_ARM_DELAY_MS, useInputArmed } from "./input-arming";

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

type LoadState =
  | { kind: "loading" }
  | { kind: "no-wallet"; runtime: RuntimePort; request: ApprovalRequest }
  | { kind: "locked"; runtime: RuntimePort; request: ApprovalRequest }
  | {
      kind: "ready";
      runtime: RuntimePort;
      request: ApprovalRequest;
      assessment: RecipientAssessment | null;
      wallet: WalletSummary | null;
    }
  | {
      kind: "awaiting-device";
      runtime: RuntimePort;
      request: ApprovalRequest;
      device: DeviceSigningRequest;
      wallet: WalletSummary | null;
    }
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

/**
 * Checks every recipient the request pays, a data item's transfer
 * included, and folds them into one: a batch warns if any recipient is
 * new or a lookalike. Best effort: a failed lookup returns `null`, and the
 * screen then warns without naming a reason.
 */
async function assessRecipientFor(
  runtime: RuntimePort,
  request: ApprovalRequest,
  walletId: string | null,
): Promise<RecipientAssessment | null> {
  const preview = request.preview;
  if (preview.kind === "connect" || preview.kind === "addToken" || preview.kind === "scanAttestation") return null;
  const transfer = transferRequestFromPreview(preview);
  if (!transfer || !walletId) return null;
  try {
    const assessments = await Promise.all(
      recipientsOf(transfer).map((recipient) =>
        runtime.send<{ walletId: string; recipient: string }, RecipientAssessment | undefined>({
          type: "assessRecipient",
          payload: { walletId, recipient },
        }),
      ),
    );
    if (assessments.some((assessment) => !assessment)) return null;
    return {
      firstTime: assessments.some((assessment) => assessment!.firstTime),
      lookalikeOf: assessments.find((assessment) => assessment!.lookalikeOf)?.lookalikeOf ?? null,
    };
  } catch {
    return null;
  }
}

/** The tokens a request moves, for the balances and prices its review reads. */
function tokensOf(request: ApprovalRequest): Array<string | null> {
  const preview = request.preview;
  if (preview.kind === "connect" || preview.kind === "addToken" || preview.kind === "scanAttestation") return [];
  const transfer = transferRequestFromPreview(preview);
  if (transfer) return transfer.transfers.filter((line) => !line.collectible).map((line) => line.token);
  return request.device ? [preview.token] : [];
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function ApprovalRoot(props: ApprovalRootProps) {
  return (
    <LocalizedRoot>
      <ApprovalRootContent {...props} />
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
      const wallet = walletState.wallets.find((candidate) => candidate.id === walletState.activeWalletId) ?? null;
      if (request.device) {
        const device = request.device;
        const signer = walletState.wallets.find((candidate) => candidate.address === device.address) ?? wallet;
        setState({ kind: "awaiting-device", runtime, request, device, wallet: signer });
      } else if (walletState.wallets.length === 0) {
        setState({ kind: "no-wallet", runtime, request });
      } else if (needsUnlock(walletState, request)) {
        setState({ kind: "locked", runtime, request });
      } else {
        const assessment = await assessRecipientFor(runtime, request, walletState.activeWalletId);
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
          loadSecurityPhrase(runtime),
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
        <div
          className="contents"
          data-input-armed={reviewing ? String(armed) : undefined}
          onClickCapture={(event) => {
            if (!guardClicks) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {content}
        </div>
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
