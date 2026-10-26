import type { HardwareWalletMethod, RuntimePort } from "@gleam/core";
import type { DeviceSignPanels } from "../approval/device-panels";

/**
 * What the screens need from the shell they run in. Screens branch on
 * `capabilities`, never on which shell mounted them, and reach the host
 * only through these ports.
 */
export interface AppCapabilities {
  sidePanel: boolean;
  passkey: boolean;
  biometrics: boolean;
  hardwareWallets: boolean;
  dappBrowser: boolean;
  /** Origins are granted at runtime, so a network URL needs a grant before it is used. */
  hostPermissions: boolean;
}

export interface HostPermissionsPort {
  contains(origins: readonly string[]): Promise<boolean>;
  request(origins: readonly string[]): Promise<boolean>;
}

/** Short-lived UI state that must survive the surface being closed and reopened. */
export interface EphemeralStatePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export type PasskeyWindowMode = "setup" | "unlock";

export interface UnlockPort {
  /**
   * `window` hands the passkey ceremony to its own window, for a surface
   * that closes when the browser's prompt takes focus. `inline` runs it
   * in the surface itself.
   */
  passkeyMode: "inline" | "window";
  openPasskeyWindow(mode: PasskeyWindowMode): Promise<void>;
}

export interface ActiveSitePort {
  /** Calls `onChange` whenever the site in view, or what is known about it, may have changed. */
  subscribe(onChange: () => void): () => void;
}

export interface DownloadsPort {
  /** Must be called from a click: browsers only show the prompt for a user gesture. */
  requestPermission(): Promise<boolean>;
}

export interface HardwareWalletsPort {
  /** Opens the page where the user connects a device, in a surface that can reach it. */
  openConnectPage(device: HardwareWalletMethod): Promise<void>;
  /**
   * The panels that talk to a device while a request awaits it, or `null`
   * where the surface can't reach the camera or WebHID.
   */
  signPanels: DeviceSignPanels | null;
}

export interface AppPlatform {
  /** The wire to the wallet's background. */
  runtime: RuntimePort;
  buildInfo: {
    version: string;
    /** Phase 1 of Gleam Points: onboarding goes through the Founding gate. Each shell sets it at build time. */
    foundingGate: boolean;
  };
  capabilities: AppCapabilities;
  hostPermissions: HostPermissionsPort;
  ephemeralState: EphemeralStatePort;
  unlock: UnlockPort;
  activeSite: ActiveSitePort;
  downloads: DownloadsPort;
  hardwareWallets: HardwareWalletsPort;
}
