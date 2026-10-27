import type { AppCapabilities } from "./types";

export function hasHardwareWallet({ hardwareWallets }: Pick<AppCapabilities, "hardwareWallets">): boolean {
  return hardwareWallets.ledger || hardwareWallets.keystone;
}
