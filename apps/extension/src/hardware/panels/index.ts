import type { DeviceSignPanels } from "@gleam/app/src/approval/device-panels.tsx";
import { KeystonePanel } from "./KeystonePanel";
import { LedgerPanel } from "./LedgerPanel";

export const DEVICE_SIGN_PANELS: DeviceSignPanels = {
  keystone: KeystonePanel,
  ledger: LedgerPanel,
};
