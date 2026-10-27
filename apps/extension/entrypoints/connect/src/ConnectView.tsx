import { useEffect, useState } from "react";
import type { RuntimePort } from "@gleam/core";
import { KeystoneConnectView, type KeystoneConnectViewProps } from "@gleam/keystone";
import { CAMERA_DENIED_HELP } from "@/src/hardware/keystone/camera-help";
import { backgroundErrorText, ConnectedNotice, ConnectShell } from "./connect-shared";

export interface ConnectViewProps {
  runtime: RuntimePort;
  /** Swapped in tests, which have no camera. */
  Scanner?: KeystoneConnectViewProps["Scanner"];
  onClose?: () => void;
  autoCloseMs?: number;
}

/** The Keystone connect page, in its own tab. */
export function ConnectView({ runtime, Scanner, onClose = () => window.close(), autoCloseMs = 3000 }: ConnectViewProps) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(timer);
  }, [done, onClose, autoCloseMs]);

  return (
    <ConnectShell title="Connect Keystone">
      {done ? (
        <ConnectedNotice device="Keystone" onClose={onClose} />
      ) : (
        <KeystoneConnectView
          runtime={runtime}
          onConnected={() => setDone(true)}
          cameraDeniedHelp={CAMERA_DENIED_HELP}
          errorText={backgroundErrorText}
          {...(Scanner ? { Scanner } : {})}
        />
      )}
    </ConnectShell>
  );
}
