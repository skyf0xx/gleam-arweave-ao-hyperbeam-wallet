import type {
  ApprovalPresenterPort,
  BadgePort,
  DeviceKeyPort,
  DownloadPort,
  SessionKeyStorePort,
  StoragePort,
  TimerPort,
} from "@gleam/core";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import type { SiteTab } from "@/src/handlers/site-wallet";

/** `ProtocolMap` messages the runtime pushes to a site's open pages. */
export type TabPush = "providerEvent" | "siteWalletMode";

/**
 * The browser tabs showing web pages, which connected dApps run in. The
 * runtime decides which tabs hear a push; this only finds and reaches them.
 */
export interface TabsPort {
  /** Every open tab showing an http(s) page. */
  webTabs(): Promise<SiteTab[]>;
  /** The tab the user is looking at, if any. */
  activeTab(): Promise<SiteTab | undefined>;
  reload(tabId: number): Promise<void>;
  /** Rejects when nothing in that tab is listening, as in a tab mid-navigation. */
  send<K extends TabPush>(tabId: number, type: K, data: Parameters<ProtocolMap[K]>[0]): Promise<void>;
}

/** Shows on the wallet's icon whether the vault is locked. */
export interface LockIndicatorPort {
  setLocked(locked: boolean): Promise<void>;
}

/**
 * Everything `createRuntime` needs from the shell it runs in. A shell
 * builds one of these from its own adapters; the runtime never reaches
 * past it to a platform API.
 */
export interface Platform {
  storage: StoragePort;
  sessionKeys: SessionKeyStorePort;
  approvalPresenter: ApprovalPresenterPort;
  /** Its `every` listeners are registered while `createRuntime` runs. */
  timer: TimerPort;
  deviceKey: DeviceKeyPort;
  badge: BadgePort;
  lockIndicator: LockIndicatorPort;
  downloads: DownloadPort;
  tabs: TabsPort;
  /** The wallet's release version, as reported to the scans API. */
  version(): string;
}
