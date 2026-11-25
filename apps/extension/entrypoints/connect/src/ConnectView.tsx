import { useState } from "react";
import type { RuntimePort } from "@gleam/core";
import { KeystoneConnectView, type KeystoneConnectViewProps } from "@gleam/keystone";
import { cameraDeniedHelp } from "@/src/hardware/keystone/camera-help";
import { backgroundErrorText, ConnectedNotice, ConnectShell, useAutoClose } from "./connect-shared";
import { useT } from "@gleam/app/src/i18n/index.tsx";

export interface ConnectViewProps {
  runtime: RuntimePort;
  /** Swapped in tests, which have no camera. */
  Scanner?: KeystoneConnectViewProps["Scanner"];
  onClose?: () => void;
  autoCloseMs?: number;
}

/** The Keystone connect page, in its own tab. */
export function ConnectView({ runtime, Scanner, onClose = () => window.close(), autoCloseMs = 3000 }: ConnectViewProps) {
  const t = useT();
  const [done, setDone] = useState(false);

  useAutoClose(done, onClose, autoCloseMs);

  return (
    <ConnectShell title={t("extension.connectKeystoneTitle")}>
      {done ? (
        <ConnectedNotice device="Keystone" onClose={onClose} />
      ) : (
        <KeystoneConnectView
          runtime={runtime}
          onConnected={() => setDone(true)}
          cameraDeniedHelp={cameraDeniedHelp}
          errorText={backgroundErrorText}
          {...(Scanner ? { Scanner } : {})}
        />
      )}
    </ConnectShell>
  );
}
