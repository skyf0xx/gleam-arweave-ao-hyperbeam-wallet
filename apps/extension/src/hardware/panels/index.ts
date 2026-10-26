import { createKeystonePanel } from "@gleam/keystone";
import type { DeviceSignPanels } from "@gleam/app/src/approval/device-panels.tsx";
import { CAMERA_DENIED_HELP } from "../keystone/camera-help";
import { LedgerPanel } from "./LedgerPanel";

export const DEVICE_SIGN_PANELS: DeviceSignPanels = {
  keystone: createKeystonePanel({ cameraDeniedHelp: CAMERA_DENIED_HELP }),
  ledger: LedgerPanel,
};
