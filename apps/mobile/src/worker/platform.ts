import type { ApprovalPresenterPort, DownloadPort } from "@gleam/core";
import { deviceKeyPort } from "@gleam/core/src/points/device-key-store.ts";
import type { Platform, TabsPort } from "@gleam/runtime";
import { createWorkerSessionKeys } from "../adapters/session-key-store";
import { connectSqliteStore, MobileStoragePort } from "../adapters/storage";
import type { WorkerTimer } from "../adapters/timer";
import { version } from "../../package.json";

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

/** The worker's `Platform`, with `scope` the worker's global scope. */
export function createWorkerPlatform(scope: Parameters<typeof connectSqliteStore>[0], timer: WorkerTimer): Platform {
  return {
    storage: new MobileStoragePort(connectSqliteStore(scope)),
    sessionKeys: createWorkerSessionKeys(),
    approvalPresenter: noApprovals,
    timer,
    deviceKey: deviceKeyPort,
    // The app has no toolbar icon to badge.
    badge: { setDot: async () => {} },
    lockIndicator: { setLocked: async () => {} },
    downloads: noDownloads,
    tabs: noTabs,
    version: () => version,
    dev: import.meta.env.DEV,
  };
}
