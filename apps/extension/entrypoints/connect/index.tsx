import React from "react";
import ReactDOM from "react-dom/client";
import "@gleam/ui/src/tokens/theme.css";
import { runtimePort } from "@/src/adapters/runtime";
import { ConnectView } from "./src/ConnectView";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectView runtime={runtimePort} />
  </React.StrictMode>,
);
