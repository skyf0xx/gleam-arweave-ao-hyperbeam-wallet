import type { HardwareWalletMethod, RuntimePort } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { usePlatform } from "../../../app-platform/context";
import { DEVICE_NAMES } from "../../../approval/device-panels";

export interface ConnectDeviceProps {
  device: HardwareWalletMethod;
  runtime: RuntimePort;
  onBack: () => void;
  onConnected: () => void;
}

/** The shell's connect view for `device`, as a screen of its own. */
export function ConnectDevice({ device, runtime, onBack, onConnected }: ConnectDeviceProps) {
  const View = usePlatform().hardwareWallets.connectViews[device];
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={`Connect ${DEVICE_NAMES[device]}`} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6">
        {View ? <View runtime={runtime} onConnected={onConnected} /> : null}
      </div>
    </div>
  );
}
