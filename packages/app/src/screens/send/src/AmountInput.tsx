import { useLayoutEffect, useRef } from "react";
import { useLocale } from "../../../i18n";
import { caretAfter, formatAmountInput, parseAmountInput, significantBefore } from "./amountInputFormat";

/**
 * The amount field. `value` is the canonical amount (ASCII digits, one "."),
 * shown with the locale's digit grouping as the user types so a long figure
 * stays readable. The caret keeps its place among the digits across the
 * regrouping.
 */
export function AmountInput({
  value,
  onChange,
  onBlur,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (canonical: string) => void;
  onBlur: () => void;
  ariaLabel: string;
  className: string;
}) {
  const locale = useLocale();
  const ref = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const display = formatAmountInput(value, locale);

  useLayoutEffect(() => {
    const input = ref.current;
    if (input === null || pendingCaret.current === null) return;
    const caret = caretAfter(input.value, pendingCaret.current, locale);
    pendingCaret.current = null;
    input.setSelectionRange(caret, caret);
  });

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder="0"
      value={display}
      onChange={(event) => {
        const raw = event.target.value;
        pendingCaret.current = significantBefore(raw, event.target.selectionStart ?? raw.length, locale);
        onChange(parseAmountInput(raw, locale));
      }}
      onBlur={onBlur}
      className={className}
    />
  );
}
