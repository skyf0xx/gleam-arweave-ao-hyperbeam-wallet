import React from "react";
import ReactDOM from "react-dom/client";
import "@gleam/ui/src/tokens/theme.css";
import { ApprovalRoot } from "./src/ApprovalRoot";

/**
 * The approval window's own real WXT entrypoint (`approval.html`) — a
 * genuinely separate popup window (`chrome.windows.create`, per
 * `adapters/windows.ts`), never a sub-view mounted inside the main
 * `<App>` shell used by `popup`/`sidepanel`. Reads `?requestId=` from
 * `location.search`, per ARCHITECTURE.md §3.1's `approval/main.tsx`
 * sketch, and mounts `ApprovalRoot` directly rather than `<App
 * layout="approval">` — the shared shell's view-switch is about
 * account-lifecycle state (onboarding/unlock/main-screen), which this
 * window doesn't share; it has its own request-driven state machine.
 */
const requestId = new URLSearchParams(location.search).get("requestId")?.trim() ?? null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApprovalRoot requestId={requestId} />
  </React.StrictMode>,
);
