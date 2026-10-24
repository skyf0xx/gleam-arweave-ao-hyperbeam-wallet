import React from "react";
import ReactDOM from "react-dom/client";
import App from "@gleam/app/src/App.tsx";
import { PlatformProvider } from "@gleam/app/src/app-platform/context.tsx";
import { createExtensionAppPlatform } from "@/src/adapters/app-platform";
import "@gleam/app/src/app.css";

const platform = createExtensionAppPlatform("popup");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlatformProvider platform={platform}>
      <App layout="popup" />
    </PlatformProvider>
  </React.StrictMode>,
);
