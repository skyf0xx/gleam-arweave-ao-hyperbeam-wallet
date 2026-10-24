import type { AppPlatform } from "@gleam/app/src/app-platform/types.ts";
import type { RuntimePort } from "@gleam/core";
import { version } from "../package.json";

/** Replaced by the worker-hosted runtime (M16); until then every call fails. */
const UNWIRED_RUNTIME: RuntimePort = {
  send: async (message) => {
    throw new Error(`The mobile runtime isn't wired yet ("${message.type}").`);
  },
  onMessage: () => () => {},
};

/**
 * The phone's `AppPlatform`. Capabilities the app gains later (biometrics,
 * the dApp browser) stay off until their adapters land.
 */
export function createMobileAppPlatform(): AppPlatform {
  // The app has one long-lived surface, so state that must outlive a
  // closed popup in the extension only needs to outlive a re-render here.
  const ephemeral = new Map<string, unknown>();
  return {
    runtime: UNWIRED_RUNTIME,
    buildInfo: { version },
    capabilities: {
      sidePanel: false,
      passkey: false,
      biometrics: false,
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
