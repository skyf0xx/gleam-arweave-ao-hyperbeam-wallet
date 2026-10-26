import { App } from "@capacitor/app";
import type { AppPlatform } from "@gleam/app/src/app-platform/types.ts";
import { version } from "../package.json";
import { createBiometricUnlock } from "./adapters/biometric-unlock";
import { createWorkerRuntimePort } from "./adapters/runtime-port";
import { createSqliteStore, openCapacitorDb, serveSqliteStore } from "./adapters/sqlite-store";

/**
 * The phone's `AppPlatform`. Capabilities the app gains later (the dApp
 * browser) stay off until their adapters land.
 */
export function createMobileAppPlatform(): AppPlatform {
  // The app has one long-lived surface, so state that must outlive a
  // closed popup in the extension only needs to outlive a re-render here.
  const ephemeral = new Map<string, unknown>();
  const worker = new Worker(new URL("./worker/index.ts", import.meta.url), { type: "module" });
  serveSqliteStore(worker, createSqliteStore(openCapacitorDb));
  const runtime = createWorkerRuntimePort(worker);
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
      biometrics: true,
      hardwareWallets: false,
      dappBrowser: false,
      hostPermissions: false,
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
    biometrics: createBiometricUnlock(),
    activeSite: { subscribe: () => () => {} },
    downloads: { requestPermission: async () => true },
    hardwareWallets: {
      openConnectPage: async () => {
        throw new Error("Hardware wallets aren't available in the app.");
      },
      signPanels: null,
    },
  };
}
