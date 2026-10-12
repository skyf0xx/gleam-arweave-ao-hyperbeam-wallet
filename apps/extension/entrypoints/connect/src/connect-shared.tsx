import type { ReactNode } from "react";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

export function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

/** Rewrites the background's refusals into copy for the connect page. */
export function backgroundErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/unlock/i.test(message)) {
    return "Gleam is locked. Click the Gleam icon in the toolbar, unlock it, then press Connect again.";
  }
  return message;
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
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-body leading-relaxed">
        {device} connected. You can close this tab.
      </p>
      <Button type="button" variant="secondary" onClick={onClose}>
        Close tab
      </Button>
    </div>
  );
}
