import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/src/App.tsx";
import { PlatformProvider } from "@/src/app-platform/context";
import { createExtensionAppPlatform } from "@/src/adapters/app-platform";
import "@gleam/ui/src/tokens/theme.css";

const platform = createExtensionAppPlatform("sidepanel");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlatformProvider platform={platform}>
      <App layout="sidepanel" />
    </PlatformProvider>
  </React.StrictMode>,
);
