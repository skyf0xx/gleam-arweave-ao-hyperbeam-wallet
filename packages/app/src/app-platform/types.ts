import type { HardwareWalletMethod, RuntimePort } from "@gleam/core";
import type { DeviceSignPanels } from "../approval/device-panels";

/**
 * What the screens need from the shell they run in. Screens branch on
 * `capabilities`, never on which shell mounted them, and reach the host
 * only through these ports.
 */
export type HardwareWalletCapabilities = Record<HardwareWalletMethod, boolean>;

export interface AppCapabilities {
  sidePanel: boolean;
  passkey: boolean;
  biometrics: boolean;
  /** Which hardware wallets the shell can reach. Use `hasHardwareWallet` for "any". */
  hardwareWallets: HardwareWalletCapabilities;
  dappBrowser: boolean;
  /** The camera can read a QR code into a field. */
  qrScanner: boolean;
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

/** What the device calls its biometric check, for the copy that names it. */
export type BiometryKind = "faceId" | "touchId" | "fingerprint" | "face" | "iris" | "biometrics";

export type BiometricAvailability =
  | { available: true; kind: BiometryKind }
  | { available: false; reason: "not-enrolled" | "no-passcode" | "unavailable" };

/**
 * Biometric unlock keeps the vault password in the device's secure
 * storage, released only by the OS after a biometric check. The app then
 * unlocks with that password exactly as if it were typed. Calls that fail
 * reject with a `BiometricError`.
 */
export interface BiometricUnlockPort {
  availability(): Promise<BiometricAvailability>;
  /** Whether a password is stored. Asks the OS without a prompt. */
  isEnrolled(): Promise<boolean>;
  /** Stores `password` behind the biometrics enrolled now. Replaces any earlier one. */
  enrol(password: string): Promise<void>;
  /** Shows the OS prompt and resolves the password it released. */
  readPassword(): Promise<string>;
  remove(): Promise<void>;
}

/**
 * Opens the device's scanner and resolves the text of the first QR code it
 * reads, or `null` when the user backs out. Failures reject with a
 * `QrScanError`. The text is untrusted input: callers validate it as if the
 * user had typed it.
 */
export interface QrScannerPort {
  scan(): Promise<string | null>;
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
  /** Reached only when `capabilities.biometrics` is on. */
  biometrics: BiometricUnlockPort;
  /** Reached only when `capabilities.qrScanner` is on. */
  qrScanner: QrScannerPort;
  activeSite: ActiveSitePort;
  downloads: DownloadsPort;
  hardwareWallets: HardwareWalletsPort;
}
