/**
 * What the screens need from the shell they run in. Screens branch on
 * `capabilities`, never on which shell mounted them, and reach the browser
 * only through these ports. Nothing under `app-platform/` may import
 * `wxt/*`, `chrome` or `browser`: it moves into the shared app package.
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

export interface AppPlatform {
  buildInfo: { version: string };
  capabilities: AppCapabilities;
  hostPermissions: HostPermissionsPort;
  ephemeralState: EphemeralStatePort;
  unlock: UnlockPort;
  activeSite: ActiveSitePort;
}
