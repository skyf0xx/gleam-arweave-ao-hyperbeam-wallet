import React from "react";
import ReactDOM from "react-dom/client";
import "@gleam/ui/src/tokens/theme.css";
import { runtimePort } from "@/src/adapters/runtime";
import { PasskeyRoot } from "./src/PasskeyRoot";
import { returnToPopup } from "./src/return-to-popup";

/**
 * The passkey window (`passkey.html`), opened by `src/passkey/open-window.ts`.
 * `?mode=setup` creates a passkey; `?mode=unlock` unlocks with one.
 * `?return=` is the browser window to reopen the Gleam popup on.
 */
const params = new URLSearchParams(location.search);
const mode = params.get("mode") === "setup" ? "setup" : "unlock";
const returnWindowId = Number.parseInt(params.get("return") ?? "", 10);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PasskeyRoot
      mode={mode}
      runtime={runtimePort}
      onFinish={(reopenPopup) => void returnToPopup(reopenPopup && Number.isFinite(returnWindowId) ? returnWindowId : null)}
    />
  </React.StrictMode>,
);
