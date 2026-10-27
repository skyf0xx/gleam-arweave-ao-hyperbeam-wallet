import { deviceKeyPort } from "@gleam/core/src/points/device-key-store.ts";
import type { Platform } from "@gleam/runtime";
import { createWorkerApprovalPresenter } from "../adapters/approval-presenter";
import { createWorkerTabs } from "../adapters/dapp-tabs";
import { createWorkerDownloads } from "../adapters/downloads";
import { createWorkerSessionKeys } from "../adapters/session-key-store";
import { connectSqliteStore, MobileStoragePort } from "../adapters/storage";
import type { WorkerTimer } from "../adapters/timer";
import { version } from "../../package.json";

/** The worker's `Platform`, with `scope` the worker's global scope. */
export function createWorkerPlatform(
  scope: Parameters<typeof connectSqliteStore>[0] & Parameters<typeof createWorkerDownloads>[0] & Parameters<typeof createWorkerTabs>[0] & Parameters<typeof createWorkerApprovalPresenter>[0],
  timer: WorkerTimer,
): Platform {
  return {
    storage: new MobileStoragePort(connectSqliteStore(scope)),
    sessionKeys: createWorkerSessionKeys(),
    approvalPresenter: createWorkerApprovalPresenter(scope),
    timer,
    deviceKey: deviceKeyPort,
    // The app has no toolbar icon to badge.
    badge: { setDot: async () => {} },
    lockIndicator: { setLocked: async () => {} },
    downloads: createWorkerDownloads(scope),
    tabs: createWorkerTabs(scope),
    version: () => version,
    dev: import.meta.env.DEV,
  };
}
