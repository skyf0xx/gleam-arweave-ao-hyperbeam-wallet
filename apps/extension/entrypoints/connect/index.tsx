import React from "react";
import ReactDOM from "react-dom/client";
import "@gleam/app/src/app.css";
import { runtimePort } from "@/src/adapters/runtime";
import { ConnectView } from "./src/ConnectView";
import { LedgerConnectView } from "./src/LedgerConnectView";

const device = new URLSearchParams(window.location.search).get("device");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {device === "ledger" ? <LedgerConnectView runtime={runtimePort} /> : <ConnectView runtime={runtimePort} />}
  </React.StrictMode>,
);
