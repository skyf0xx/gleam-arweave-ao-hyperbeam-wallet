import type { ApprovalPresenterPort, DeviceKeyPort, DownloadPort, SessionKeyStorePort } from "@gleam/core";
import type { Platform, TabsPort } from "@gleam/runtime";
import { InMemoryTimer } from "@gleam/runtime/testing/index.ts";
import { connectSqliteStore, MobileStoragePort } from "../adapters/storage";
import { version } from "../../package.json";

// Holds no key, so every wallet stays locked until the worker's key store (M18).
const noSessionKeys: SessionKeyStorePort = {
  importKey: async () => {
    throw new Error("Unlocking isn't available in the app yet.");
  },
  sign: async () => {
    throw new Error("This wallet is locked.");
  },
  decrypt: async () => {
    throw new Error("This wallet is locked.");
  },
  has: async () => [],
  remove: async () => {},
  clear: async () => {},
};

// dApp approvals arrive with the dApp browser; until then nothing in the
// app opens one.
const noApprovals: ApprovalPresenterPort = {
  present: async () => {
    throw new Error("Approvals aren't available in the app yet.");
  },
  focus: async () => {},
  dismiss: async () => {},
  onDismissed: () => () => {},
};

const noDeviceKey: DeviceKeyPort = {
  loadOrCreate: async () => {
    throw new Error("Gleam Points isn't available in the app yet.");
  },
};

const noDownloads: DownloadPort = {
  isAllowed: async () => false,
  ensureAllowed: async () => false,
  saveFile: async () => ({ ok: false, reason: "failed" }),
};

// The app has no browser tabs: dApps open in its own dApp view.
const noTabs: TabsPort = {
  webTabs: async () => [],
  activeTab: async () => undefined,
  reload: async () => {},
  send: async () => {
    throw new Error("The app has no browser tabs.");
  },
};

/**
 * The worker's `Platform`, with `scope` the worker's global scope. The
 * timer is in memory until the worker timer (M19) replaces it.
 */
export function createWorkerPlatform(scope: Parameters<typeof connectSqliteStore>[0]): Platform {
  return {
    storage: new MobileStoragePort(connectSqliteStore(scope)),
    sessionKeys: noSessionKeys,
    approvalPresenter: noApprovals,
    timer: new InMemoryTimer(),
    deviceKey: noDeviceKey,
    // The app has no toolbar icon to badge.
    badge: { setDot: async () => {} },
    lockIndicator: { setLocked: async () => {} },
    downloads: noDownloads,
    tabs: noTabs,
    version: () => version,
    dev: import.meta.env.DEV,
  };
}
