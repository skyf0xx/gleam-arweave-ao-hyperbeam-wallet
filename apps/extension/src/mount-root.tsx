import React, { type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { PlatformProvider } from "@gleam/app/src/app-platform/context.tsx";
import type { AppPlatform } from "@gleam/app/src/app-platform/types.ts";

/** Renders `node` into `#root`, inside the app's `platform` when the page has one. */
export function mountRoot(node: ReactNode, platform?: AppPlatform): void {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>{platform ? <PlatformProvider platform={platform}>{node}</PlatformProvider> : node}</React.StrictMode>,
  );
}
