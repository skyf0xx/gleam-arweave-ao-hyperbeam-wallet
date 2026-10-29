import { render } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import type { ReactElement, ReactNode } from "react";
import { PlatformProvider } from "./context";
import { unavailableDappBrowser } from "./dapp-browser";
import type { AppPlatform, QueryCachePort } from "./types";

export type FakeAppPlatformOverrides = Partial<Omit<AppPlatform, "buildInfo" | "capabilities">> & {
  buildInfo?: Partial<AppPlatform["buildInfo"]>;
  capabilities?: Partial<Omit<AppPlatform["capabilities"], "hardwareWallets">> & {
    hardwareWallets?: Partial<AppPlatform["capabilities"]["hardwareWallets"]>;
  };
};

/** Tests that reach the background pass a `runtime` prop or override this. */
const UNWIRED_RUNTIME: RuntimePort = {
  send: async (message) => {
    throw new Error(`fakeAppPlatform has no runtime for "${message.type}"`);
  },
  onMessage: () => () => {},
};

/** An in-memory `QueryCachePort`; `entries` is exposed for assertions. */
export function memoryQueryCache(entries = new Map<string, string>()): QueryCachePort & { entries: Map<string, string> } {
  return {
    entries,
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      entries.set(key, value);
    },
    remove: async (key) => {
      entries.delete(key);
    },
    keys: async () => [...entries.keys()],
    clear: async () => {
      entries.clear();
    },
  };
}

export function fakeAppPlatform(overrides: FakeAppPlatformOverrides = {}): AppPlatform {
  const state = new Map<string, unknown>();
  return {
    runtime: overrides.runtime ?? UNWIRED_RUNTIME,
    buildInfo: { version: "1.2.3", foundingGate: true, ...overrides.buildInfo },
    capabilities: {
      sidePanel: true,
      passkey: true,
      biometrics: false,
      dappBrowser: false,
      qrScanner: false,
      lockOnSystemLock: true,
      hostPermissions: true,
      ...overrides.capabilities,
      hardwareWallets: { ledger: true, keystone: true, ...overrides.capabilities?.hardwareWallets },
    },
    hostPermissions: overrides.hostPermissions ?? {
      contains: async () => true,
      request: async () => true,
    },
    ephemeralState: overrides.ephemeralState ?? {
      get: async (key) => state.get(key),
      set: async (key, value) => {
        state.set(key, value);
      },
      remove: async (key) => {
        state.delete(key);
      },
    },
    queryCache: overrides.queryCache ?? memoryQueryCache(),
    unlock: overrides.unlock ?? { passkeyMode: "inline", openPasskeyWindow: async () => {} },
    biometrics: overrides.biometrics ?? {
      availability: async () => ({ available: false, reason: "unavailable" }),
      isEnrolled: async () => false,
      enrol: async () => {},
      readPassword: async () => {
        throw new Error("fakeAppPlatform has no stored password");
      },
      remove: async () => {},
    },
    qrScanner: overrides.qrScanner ?? {
      scan: async () => {
        throw new Error("fakeAppPlatform has no scanner");
      },
    },
    activeSite: overrides.activeSite ?? { subscribe: () => () => {} },
    downloads: overrides.downloads ?? { requestPermission: async () => true },
    hardwareWallets: overrides.hardwareWallets ?? { openConnectPage: async () => {}, connectViews: {}, signPanels: null },
    storeReview: overrides.storeReview ?? { opensPage: true, request: async () => {} },
    dappBrowser: overrides.dappBrowser ?? unavailableDappBrowser,
    ...(overrides.backButton ? { backButton: overrides.backButton } : {}),
    ...(overrides.approvalSheet ? { approvalSheet: overrides.approvalSheet } : {}),
    ...(overrides.notices ? { notices: overrides.notices } : {}),
  };
}

/** A `renderHook`/`render` wrapper that supplies a fake platform. */
export function platformWrapper(platform: AppPlatform = fakeAppPlatform()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <PlatformProvider platform={platform}>{children}</PlatformProvider>;
  };
}

export function renderWithPlatform(ui: ReactElement, platform: AppPlatform = fakeAppPlatform()) {
  return render(ui, { wrapper: platformWrapper(platform) });
}
