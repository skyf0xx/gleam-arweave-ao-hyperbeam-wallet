import type { ReactElement } from "react";
import type { DeviceSigningPayload, DeviceSigningRequest, HardwareWalletMethod } from "@gleam/core";

export type DeviceSigningWallet = Pick<DeviceSigningRequest, "method" | "device" | "address" | "publicKey">;

/**
 * Talks to one kind of hardware wallet from the approval UI, which in the
 * extension is the only context that can reach the camera (Keystone's QR
 * scanner) or WebHID (Ledger), and renders whatever that takes. It calls `onSignatures` with
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

/** A shell lists only the devices it can reach. */
export type DeviceSignPanels = Partial<Record<HardwareWalletMethod, DeviceSignPanel>>;

export const DEVICE_NAMES: Record<HardwareWalletMethod, string> = {
  keystone: "Keystone",
  ledger: "Ledger",
};
