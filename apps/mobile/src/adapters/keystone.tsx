import { lazy, Suspense } from "react";
import type { HardwareConnectView, HardwareConnectViewProps } from "@gleam/app/src/app-platform/types.ts";
import type { DeviceSignPanel } from "@gleam/app/src/approval/device-panels.tsx";

const CAMERA_DENIED_HELP = "Turn on camera access for Gleam in your phone's Settings, then try again.";

// The Keystone libraries load when a Keystone screen first opens, so they
// stay out of the bundle every launch parses.
const keystone = () => import("@gleam/keystone");

const LazyPanel = lazy(async () => ({
  default: (await keystone()).createKeystonePanel({ cameraDeniedHelp: CAMERA_DENIED_HELP }),
}));

const LazyConnectView = lazy(async () => {
  const { KeystoneConnectView } = await keystone();
  return {
    default: (props: HardwareConnectViewProps) => (
      <KeystoneConnectView {...props} cameraDeniedHelp={CAMERA_DENIED_HELP} />
    ),
  };
});

/**
 * Scans through `getUserMedia` in the app's own WebView rather than the
 * native scanner plugin: an animated UR needs every camera frame, and the
 * plugin returns one code per scan.
 */
export const KeystonePanel: DeviceSignPanel = (props) => (
  <Suspense fallback={null}>
    <LazyPanel {...props} />
  </Suspense>
);

export const KeystoneConnect: HardwareConnectView = (props) => (
  <Suspense fallback={null}>
    <LazyConnectView {...props} />
  </Suspense>
);
