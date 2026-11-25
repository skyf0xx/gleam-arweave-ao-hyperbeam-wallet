import type { ReactNode } from "react";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { useT } from "../i18n";

/** The reject and confirm buttons at the foot of an approval. */
export function ApprovalActions({
  onReject,
  confirmLabel,
  onConfirm,
  confirmVariant = "primary",
  submitting,
  disableRejectWhileSubmitting = false,
  padTop = true,
}: {
  onReject: () => void;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  confirmVariant?: "primary" | "destructive";
  /** Set by approvals that sign: disables the confirm button and marks it busy. */
  submitting?: boolean;
  disableRejectWhileSubmitting?: boolean;
  padTop?: boolean;
}) {
  const t = useT();
  return (
    <div className={padTop ? "mt-auto flex gap-2.5 pt-1" : "mt-auto flex gap-2.5"}>
      <Button
        type="button"
        variant="secondary"
        disabled={disableRejectWhileSubmitting ? submitting : undefined}
        onClick={onReject}
        className="flex-1"
      >
        {t("approval.reject")}
      </Button>
      <Button
        type="button"
        variant={confirmVariant}
        disabled={submitting}
        aria-busy={submitting}
        onClick={onConfirm}
        className="flex-1"
      >
        {confirmLabel}
      </Button>
    </div>
  );
}
