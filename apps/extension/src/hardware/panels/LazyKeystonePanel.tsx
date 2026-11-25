import { useEffect, useState } from "react";
import type { DeviceSignPanel, DeviceSignPanelProps } from "@gleam/app/src/approval/device-panels.tsx";
import { errorText } from "@gleam/app/src/i18n/errors.ts";
import { retryingOnce } from "@gleam/core/src/models/async.ts";

/**
 * The Keystone UR stack and its Node polyfills are most of what the
 * approval page would load, and only a Keystone wallet's signing step
 * uses them. `check-bundles.mjs` holds this chunk to its own list.
 * A failed load isn't kept, so Try again, which remounts the panel, asks again.
 */
const loadKeystonePanel = retryingOnce<DeviceSignPanel>(() => import("./keystone").then(({ KeystonePanel }) => KeystonePanel));

export function LazyKeystonePanel(props: DeviceSignPanelProps) {
  const [Panel, setPanel] = useState<DeviceSignPanel | null>(null);
  const { onError } = props;
  useEffect(() => {
    let mounted = true;
    loadKeystonePanel().then(
      (panel) => {
        if (mounted) setPanel(() => panel);
      },
      (error: unknown) => {
        if (mounted) onError(errorText(error));
      },
    );
    return () => {
      mounted = false;
    };
  }, [onError]);
  return Panel ? <Panel {...props} /> : <div aria-busy="true" />;
}
