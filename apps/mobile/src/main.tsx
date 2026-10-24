import React from "react";
import ReactDOM from "react-dom/client";
import App from "@gleam/app/src/App.tsx";
import { PlatformProvider } from "@gleam/app/src/app-platform/context.tsx";
import { createMobileAppPlatform } from "./app-platform";
import "@gleam/app/src/app.css";

const platform = createMobileAppPlatform();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlatformProvider platform={platform}>
      <App layout="phone" />
    </PlatformProvider>
  </React.StrictMode>,
);
