import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { AppPlatform } from "@gleam/app/src/app-platform/types.ts";
import { DappView } from "@gleam/dapp-view";
import providerScript from "virtual:gleam-provider-script";
import { version } from "../package.json";
import { onAppAway } from "./adapters/app-away";
import { createApprovalSheet, serveApprovalSheet } from "./adapters/approval-sheet";
import { createBackButton } from "./adapters/back-button";
import { createBiometricUnlock } from "./adapters/biometric-unlock";
import { KeystoneConnect, KeystonePanel } from "./adapters/keystone";
import { createQrScanner } from "./adapters/qr-scanner";
import { createStoreReview } from "./adapters/store-review";
import { createDappBridge, serveDappTabs } from "./adapters/dapp-bridge";
import { createDappBrowser } from "./adapters/dapp-browser";
import { guardLock } from "./adapters/lock-guard";
import { createCapacitorFileSaver, serveFileSaver, sweepCapacitorExports } from "./adapters/file-saver";
import { createWorkerRuntimePort } from "./adapters/runtime-port";
import { createSqliteStore, openCapacitorDb, serveSqliteStore } from "./adapters/sqlite-store";

/**
 * The phone's `AppPlatform`. Capabilities the app gains later (the dApp
 * browser) stay off until their adapters land.
 */
export async function createMobileAppPlatform(): Promise<AppPlatform> {
  // `import.meta.env.DEV` has to stay a bare literal in this condition so the
  // bundler folds it to `false` and drops the preview chunk from production
  // builds; an on-device build then can't reach in-memory storage. The native
  // check keeps `vite dev` inside a Capacitor shell on the real adapters.
  const preview =
    import.meta.env.DEV && !Capacitor.isNativePlatform()
      ? (await import("./preview")).createPreviewPorts()
      : undefined;
  // The app has one long-lived surface, so state that must outlive a
  // closed popup in the extension only needs to outlive a re-render here.
  const ephemeral = new Map<string, unknown>();
  const worker = new Worker(new URL("./worker/index.ts", import.meta.url), { type: "module" });
  serveSqliteStore(worker, preview?.store ?? createSqliteStore(openCapacitorDb));
  if (!preview) void sweepCapacitorExports();
  serveFileSaver(worker, preview?.fileSaver ?? createCapacitorFileSaver());
  const workerRuntime = createWorkerRuntimePort(worker);
  const dapps = createDappBridge({ plugin: DappView, runtime: workerRuntime, providerScript });
  const dappBrowser = preview?.dappBrowser ?? createDappBrowser({ bridge: dapps, plugin: DappView });
  serveDappTabs(worker, dapps.tabs);
  // The browser preview has no native dApp view to listen to.
  dapps.listening.catch(() => undefined);
  const approvalSheet = createApprovalSheet();
  serveApprovalSheet(worker, approvalSheet);
  approvalSheet.subscribe((requestId) => {
    dappBrowser.setSheetUp(requestId !== null).catch(() => undefined);
  });
  const runtime = guardLock(
    workerRuntime,
    () => {
      approvalSheet.dismissAll();
      dapps.close().catch(() => undefined);
    },
    () => {
      approvalSheet.dismissAll();
      // Closes through the bridge first, then wipes cookies and storage.
      dappBrowser.clearSiteData().catch(() => undefined);
    },
  );
  // A request left up while the app is away would still be there on return,
  // so it's rejected instead.
  onAppAway(() => approvalSheet.dismissAll());
  // The worker's intervals stop while the app is in the background; this
  // runs the ones that came due, auto-lock among them.
  void App.addListener("resume", () => {
    runtime.resume().catch((error: unknown) => console.error("Couldn't resume the runtime.", error));
  });
  return {
    runtime,
    // Set `VITE_FOUNDING_GATE=false` for the Phase 2 build; it's on otherwise.
    buildInfo: { version, foundingGate: import.meta.env.VITE_FOUNDING_GATE !== "false" },
    capabilities: {
      sidePanel: false,
      passkey: false,
      biometrics: preview?.capabilities.biometrics ?? true,
      hardwareWallets: { ledger: false, keystone: true },
      dappBrowser: true,
      qrScanner: preview?.capabilities.qrScanner ?? true,
      hostPermissions: false,
      lockOnSystemLock: false,
    },
    hostPermissions: { contains: async () => true, request: async () => true },
    ephemeralState: {
      get: async (key) => ephemeral.get(key),
      set: async (key, value) => {
        ephemeral.set(key, value);
      },
      remove: async (key) => {
        ephemeral.delete(key);
      },
    },
    unlock: {
      passkeyMode: "inline",
      openPasskeyWindow: async () => {
        throw new Error("Passkeys aren't available in the app.");
      },
    },
    biometrics: preview?.biometrics ?? createBiometricUnlock(),
    qrScanner: preview?.qrScanner ?? createQrScanner(),
    storeReview: preview?.storeReview ?? createStoreReview(),
    dappBrowser,
    backButton: createBackButton(),
    approvalSheet,
    activeSite: { subscribe: () => () => {} },
    downloads: { requestPermission: async () => true },
    hardwareWallets: {
      openConnectPage: async () => {
        throw new Error("Ledger isn't available in the app.");
      },
      connectViews: { keystone: KeystoneConnect },
      signPanels: { keystone: KeystonePanel },
    },
  };
}
