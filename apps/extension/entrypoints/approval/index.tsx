import React from "react";
import ReactDOM from "react-dom/client";
import "@gleam/app/src/app.css";
import { PlatformProvider } from "@gleam/app/src/app-platform/context.tsx";
import { createExtensionAppPlatform } from "@/src/adapters/app-platform";
import { ApprovalRoot } from "@gleam/app/src/approval/ApprovalRoot.tsx";
import { DEVICE_SIGN_PANELS } from "@/src/hardware/panels";

/**
 * The approval window's own real WXT entrypoint (`approval.html`) — a
 * genuinely separate popup window (`chrome.windows.create`, per
 * `adapters/windows.ts`), never a sub-view mounted inside the main
 * `<App>` shell used by `popup`/`sidepanel`. Reads `?requestId=` from
 * `location.search` and mounts `ApprovalRoot` directly rather than `<App
 * layout="approval">` — the shared shell's view-switch is about
 * account-lifecycle state (onboarding/unlock/main-screen), which this
 * window doesn't share; it has its own request-driven state machine.
 */
const requestId = new URLSearchParams(location.search).get("requestId")?.trim() ?? null;

const platform = createExtensionAppPlatform("window", { signPanels: DEVICE_SIGN_PANELS });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlatformProvider platform={platform}>
      <ApprovalRoot requestId={requestId} />
    </PlatformProvider>
  </React.StrictMode>,
);
