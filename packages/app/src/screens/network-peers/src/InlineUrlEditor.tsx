import type { ReactNode } from "react";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { useT } from "../../../i18n";
import { InlineInput } from "@gleam/ui/src/primitives/inline-input.tsx";

/** An address typed in place of its row, with the save and cancel buttons under it. */
export function InlineUrlEditor({
  placeholder,
  value,
  onChange,
  error,
  submitLabel,
  submitDisabled,
  onSubmit,
  onCancel,
  extraAction,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  submitLabel: string;
  submitDisabled: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  /** Pushed to the right of the buttons. */
  extraAction?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 py-3.5">
      <InlineInput
        type="text"
        autoFocus
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full font-mono"
      />
      {error ? <InlineError as="span">{error}</InlineError> : null}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={submitDisabled}
          onClick={onSubmit}
          className="text-label font-semibold text-foreground disabled:opacity-60"
        >
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-label font-semibold text-muted">
          {t("networkPeers.cancel")}
        </button>
        {extraAction}
      </div>
    </div>
  );
}
