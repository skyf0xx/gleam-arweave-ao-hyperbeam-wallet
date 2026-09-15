import { useEffect, useState, type ReactNode } from "react";
import type { ApprovalRequest, RuntimePort, ThemeSettings, WalletState } from "@gleam/core";
import { OnboardingView } from "@/entrypoints/popup/onboarding/index.tsx";
import { ConnectionRequestScreen } from "./ConnectionRequestScreen";
import { SigningApprovalScreen } from "./SigningApprovalScreen";

/**
 * The approval window's top-level state machine: loads the pending
 * `ApprovalRequest` for `requestId` via `getApproval`, escalates to
 * onboarding in place if no wallet exists yet (ARCHITECTURE.md §3.1's
 * "Approval-window escalation" rule — "switch to onboarding in place and
 * return to the pending request afterward, rather than rejecting the
 * dApp"), then renders `ConnectionRequestScreen` or
 * `SigningApprovalScreen` depending on `request.kind`.
 *
 * `runtime` resolution mirrors `App.tsx`'s own documented reason exactly:
 * a dynamic `import()` inside `useEffect`, never a static top-level
 * import, since `@webext-core/messaging` throws synchronously outside a
 * real extension context (including this component's own test file).
 *
 * Theme: this window never mounts `<App>` (`approval/index.tsx`'s own
 * doc comment — a genuinely separate root, its own state machine), so
 * `App.tsx`'s `applyTheme`/`data-theme` wiring never runs here despite
 * that file's comment describing approval as one of "every surface" —
 * confirmed false for this window while building this task. Mirrors
 * `applyTheme` exactly (same fetch, same light fallback on any failure,
 * including the dispatcher not yet registering the method) so the
 * two surfaces apply identically instead of reimplementing the read
 * differently.
 */
export interface ApprovalRootProps {
  requestId: string | null;
  runtime?: RuntimePort;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "no-wallet"; runtime: RuntimePort }
  | { kind: "ready"; runtime: RuntimePort; request: ApprovalRequest }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

export function ApprovalRoot({ requestId, runtime: runtimeProp }: ApprovalRootProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [theme, setTheme] = useState<ThemeSettings["theme"]>("light");

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
      const walletState = await runtime.send<void, WalletState>({ type: "getState", payload: undefined });
      if (walletState.wallets.length === 0) {
        setState({ kind: "no-wallet", runtime });
        return;
      }
      const request = await runtime.send<{ requestId: string }, ApprovalRequest>({
        type: "getApproval",
        payload: { requestId: id },
      });
      setState({ kind: "ready", runtime, request });
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
        const runtime = runtimeProp ?? (await import("@/src/adapters/runtime")).runtimePort;
        if (cancelled) return;
        await Promise.all([load(runtime, requestId), applyTheme(runtime)]);
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

  let content: ReactNode;

  if (state.kind === "loading") {
    content = <CenteredMessage text="Loading…" />;
  } else if (state.kind === "error") {
    content = <CenteredMessage text={state.message} />;
  } else if (state.kind === "done") {
    content = <CenteredMessage text={state.message} />;
  } else if (state.kind === "no-wallet") {
    content = (
      <OnboardingView
        runtime={state.runtime}
        onComplete={() => {
          if (requestId) void load(state.runtime, requestId);
        }}
      />
    );
  } else {
    const { runtime, request } = state;

    const handleReject = async () => {
      try {
        await runtime.send<{ requestId: string; approved: boolean }, void>({
          type: "resolveApproval",
          payload: { requestId: request.requestId, approved: false },
        });
      } finally {
        setState({ kind: "done", message: "Request rejected." });
      }
    };

    if (request.preview.kind === "connect") {
      const preview = request.preview;
      content = (
        <ConnectionRequestScreen
          origin={request.origin}
          preview={preview}
          onReject={() => void handleReject()}
          onGrant={async () => {
            try {
              await runtime.send<{ requestId: string; approved: boolean }, void>({
                type: "resolveApproval",
                payload: { requestId: request.requestId, approved: true },
              });
              setState({ kind: "done", message: "Grant approved." });
            } catch (error) {
              setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
            }
          }}
        />
      );
    } else {
      const signingPreview = request.preview;
      content = (
        <SigningApprovalScreen
          origin={request.origin}
          preview={signingPreview}
          onReject={() => void handleReject()}
          onSign={async () => {
            try {
              await runtime.send<{ requestId: string; approved: boolean }, void>({
                type: "resolveApproval",
                payload: { requestId: request.requestId, approved: true },
              });
              setState({ kind: "done", message: "Signed." });
            } catch (error) {
              throw error instanceof Error ? error : new Error(String(error));
            }
          }}
        />
      );
    }
  }

  return (
    <div data-theme={theme === "dark" ? "dark" : undefined} className="min-h-full">
      {content}
    </div>
  );
}

function CenteredMessage({ text }: { text: string }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6 text-center text-sm text-[#737373]">
      {text}
    </div>
  );
}
