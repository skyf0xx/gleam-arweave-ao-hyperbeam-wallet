import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { PlatformProvider } from "./context";
import type { AppPlatform } from "./types";

export type FakeAppPlatformOverrides = Partial<Omit<AppPlatform, "buildInfo" | "capabilities">> & {
  buildInfo?: Partial<AppPlatform["buildInfo"]>;
  capabilities?: Partial<AppPlatform["capabilities"]>;
};

export function fakeAppPlatform(overrides: FakeAppPlatformOverrides = {}): AppPlatform {
  const state = new Map<string, unknown>();
  return {
    buildInfo: { version: "1.2.3", ...overrides.buildInfo },
    capabilities: {
      sidePanel: true,
      passkey: true,
      biometrics: false,
      hardwareWallets: true,
      dappBrowser: false,
      hostPermissions: true,
      ...overrides.capabilities,
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
    unlock: overrides.unlock ?? { passkeyMode: "inline", openPasskeyWindow: async () => {} },
    activeSite: overrides.activeSite ?? { subscribe: () => () => {} },
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
