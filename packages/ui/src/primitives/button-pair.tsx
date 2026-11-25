import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./button";

export interface ButtonPairProps {
  cancelLabel: ReactNode;
  onCancel: () => void;
  cancelDisabled?: boolean;
  confirmLabel: ReactNode;
  /** Omit with `confirmType="submit"` to confirm through the form. */
  onConfirm?: () => void;
  confirmType?: "button" | "submit";
  confirmVariant?: ButtonProps["variant"];
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
  size?: ButtonProps["size"];
}

/** A cancel button and the button that confirms, side by side and equally wide. */
export function ButtonPair({
  cancelLabel,
  onCancel,
  cancelDisabled,
  confirmLabel,
  onConfirm,
  confirmType = "button",
  confirmVariant,
  confirmDisabled,
  confirmBusy,
  size,
}: ButtonPairProps) {
  return (
    <div className="flex gap-2">
      <Button type="button" variant="secondary" size={size} disabled={cancelDisabled} onClick={onCancel} className="flex-1">
        {cancelLabel}
      </Button>
      <Button
        type={confirmType}
        variant={confirmVariant}
        size={size}
        disabled={confirmDisabled}
        aria-busy={confirmBusy}
        onClick={onConfirm}
        className="flex-1"
      >
        {confirmLabel}
      </Button>
    </div>
  );
}
