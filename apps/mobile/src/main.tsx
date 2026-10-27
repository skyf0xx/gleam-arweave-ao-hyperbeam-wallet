import React from "react";
import ReactDOM from "react-dom/client";
import App from "@gleam/app/src/App.tsx";
import { PlatformProvider } from "@gleam/app/src/app-platform/context.tsx";
import type { AppPlatform } from "@gleam/app/src/app-platform/types.ts";
import { createMobileAppPlatform } from "./app-platform";
import "@gleam/app/src/app.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
// A new key remounts the app, so the Founding gate reads its state again.
let generation = 0;

function render(platform: AppPlatform) {
  root.render(
    <React.StrictMode>
      <PlatformProvider platform={platform}>
        <App key={generation} layout="phone" />
      </PlatformProvider>
    </React.StrictMode>,
  );
}

const platform: AppPlatform = await createMobileAppPlatform({
  onInviteGateChanged: () => {
    generation += 1;
    // Only runs after a reply from the worker, by which time `platform` is set.
    render(platform);
  },
});
render(platform);
