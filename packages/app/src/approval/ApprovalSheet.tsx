import { useEffect, useState } from "react";
import { useBackHandler } from "@gleam/ui/src/primitives/back-stack.tsx";
import { Sheet } from "@gleam/ui/src/primitives/sheet.tsx";
import type { ApprovalSheetPort } from "../app-platform/types";
import { ApprovalRoot } from "./ApprovalRoot";

export interface ApprovalSheetProps {
  port: ApprovalSheetPort;
  /** Inside the layout root, so the sheet keeps the phone styles. */
  container: HTMLElement | null;
}

/** Registers only while the sheet is up, so the system back press reaches it before the screen under it. */
function DismissOnBack({ onBack }: { onBack: () => void }) {
  useBackHandler(onBack);
  return null;
}

/**
 * The approval UI as a sheet over whatever screen is up. Closing it any way
 * but a decision (swipe, backdrop, back press) reports a dismissal, which
 * rejects the request.
 */
export function ApprovalSheet({ port, container }: ApprovalSheetProps) {
  // The id is kept after the sheet closes so its content stays until it has slid away.
  const [shown, setShown] = useState<{ requestId: string; open: boolean } | null>(null);

  useEffect(
    () =>
      port.subscribe((requestId) =>
        setShown((previous) =>
          requestId !== null ? { requestId, open: true } : previous && { ...previous, open: false },
        ),
      ),
    [port],
  );

  if (!shown) return null;
  const { requestId, open } = shown;
  const dismiss = () => port.dismissed(requestId);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && dismiss()} label="Approval request" container={container}>
      {open ? <DismissOnBack onBack={dismiss} /> : null}
      <ApprovalRoot key={requestId} requestId={requestId} onClose={dismiss} />
    </Sheet>
  );
}
