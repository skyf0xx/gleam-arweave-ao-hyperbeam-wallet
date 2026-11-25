import { useEffect, type ReactNode } from "react";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { errorText } from "@gleam/app/src/i18n/errors.ts";
import { t, useT } from "@gleam/app/src/i18n/index.tsx";
import { errorMessage } from "@gleam/core";

/** Rewrites the background's refusals into copy for the connect page. */
export function backgroundErrorText(error: unknown): string {
  const message = errorMessage(error);
  if (/unlock/i.test(message)) {
    return t("extension.lockedHelp");
  }
  return errorText(error);
}

/** Calls `onClose` `ms` after `done` turns true, so the tab closes itself once the device is connected. */
export function useAutoClose(done: boolean, onClose: () => void, ms: number): void {
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(onClose, ms);
    return () => clearTimeout(timer);
  }, [done, onClose, ms]);
}

export function ConnectShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas px-4 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-(--container-md) flex-col gap-5 rounded-lg border border-line bg-background p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight">{title}</h1>
          <Beam />
        </div>
        {children}
      </div>
    </main>
  );
}

export function ConnectedNotice({ device, onClose }: { device: string; onClose: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-body leading-relaxed">
        {t("extension.deviceConnected", { device })}
      </p>
      <Button type="button" variant="secondary" onClick={onClose}>
        {t("extension.closeTab")}
      </Button>
    </div>
  );
}
