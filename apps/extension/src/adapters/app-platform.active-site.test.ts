import { afterEach, describe, expect, it, vi } from "vitest";

type StorageListener = (changes: Record<string, unknown>, area: string) => void;
const storageListeners = new Set<StorageListener>();

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { getManifest: () => ({ version: "1.2.3" }) },
    storage: {
      onChanged: {
        addListener: (listener: StorageListener) => storageListeners.add(listener),
        removeListener: (listener: StorageListener) => storageListeners.delete(listener),
      },
    },
  },
}));

vi.mock("./runtime", () => ({ runtimePort: {} }));

const { createExtensionAppPlatform } = await import("./app-platform");

afterEach(() => {
  storageListeners.clear();
});

function changeStorage(key: string, area: string): void {
  for (const listener of storageListeners) listener({ [key]: { newValue: {} } }, area);
}

describe("extension AppPlatform activeSite", () => {
  it("reports when a tab's other-wallet report changes", () => {
    const onChange = vi.fn();
    createExtensionAppPlatform("popup").activeSite.subscribe(onChange);

    changeStorage("siteWallet:tab:7", "session");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores other storage changes", () => {
    const onChange = vi.fn();
    createExtensionAppPlatform("popup").activeSite.subscribe(onChange);

    changeStorage("wallets", "session");
    changeStorage("siteWallet:tab:7", "local");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops listening when unsubscribed", () => {
    const unsubscribe = createExtensionAppPlatform("popup").activeSite.subscribe(vi.fn());
    unsubscribe();
    expect(storageListeners.size).toBe(0);
  });

  it("runs the passkey unlock in place on every surface, the popup included", () => {
    expect(createExtensionAppPlatform("popup").unlock.passkeyMode).toBe("inline");
    expect(createExtensionAppPlatform("sidepanel").unlock.passkeyMode).toBe("inline");
    expect(createExtensionAppPlatform("window").unlock.passkeyMode).toBe("inline");
  });
});
