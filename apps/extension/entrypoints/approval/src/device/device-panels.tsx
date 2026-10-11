import type { ReactElement } from "react";
import { KeystonePanel } from "./KeystonePanel";
import type { DeviceSigningPayload, DeviceSigningRequest, HardwareWalletMethod } from "@gleam/core";

export type DeviceSigningWallet = Pick<DeviceSigningRequest, "method" | "device" | "address" | "publicKey">;

/**
 * Talks to one kind of hardware wallet from the approval window, the only
 * context that can reach the camera (Keystone's QR scanner) or WebHID
 * (Ledger), and renders whatever that takes. It calls `onSignatures` with
 * one base64url RSA-PSS signature per payload, in order; the background
 * verifies each against the wallet's stored public key. `onActivity`
 * keeps the request open while the device works. A panel is remounted to
 * retry after an error.
 */
export interface DeviceSignPanelProps {
  payloads: DeviceSigningPayload[];
  wallet: DeviceSigningWallet;
  onSignatures(signatures: string[]): void;
  onActivity(): void;
  onError(message: string): void;
  onCancel(): void;
}

export type DeviceSignPanel = (props: DeviceSignPanelProps) => ReactElement;

export type DeviceSignPanels = Record<HardwareWalletMethod, DeviceSignPanel>;

export const DEVICE_NAMES: Record<HardwareWalletMethod, string> = {
  keystone: "Keystone",
  ledger: "Ledger",
};

function unsupportedPanel(method: HardwareWalletMethod): DeviceSignPanel {
  return function UnsupportedDevicePanel() {
    return (
      <p className="text-center text-label leading-snug text-muted">
        Signing with {DEVICE_NAMES[method]} isn&apos;t supported yet.
      </p>
    );
  };
}

export const DEFAULT_DEVICE_PANELS: DeviceSignPanels = {
  keystone: KeystonePanel,
  ledger: unsupportedPanel("ledger"),
};
