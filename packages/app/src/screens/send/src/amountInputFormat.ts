interface Separators {
  group: string;
  decimal: string;
}

function separatorsFor(locale: string): Separators {
  const parts = new Intl.NumberFormat(locale).formatToParts(10000.5);
  return {
    group: parts.find((part) => part.type === "group")?.value ?? ",",
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
  };
}

/**
 * Turns what the user typed or pasted into the canonical amount: ASCII
 * digits and at most one ".". The locale's group character is dropped, so
 * re-parsing a grouped display is stable; any other "." or "," counts as the
 * decimal point, which keeps a numpad "." working in comma-decimal locales.
 */
export function parseAmountInput(raw: string, locale: string): string {
  const { group, decimal } = separatorsFor(locale);
  let out = "";
  let seenDecimal = false;
  for (const char of raw) {
    if (char >= "0" && char <= "9") {
      out += char;
    } else if (!seenDecimal && char !== group && (char === decimal || char === "." || char === ",")) {
      out += ".";
      seenDecimal = true;
    }
  }
  return out;
}

/**
 * Parses a field edit. Where "." is the locale's group character (pt-BR, de,
 * es, it, nl), a "." the user types is the decimal point, since the display
 * only ever puts groups there itself. A pasted lone "." with other than
 * three digits after it is a decimal too ("1.5"), while "10.000" and
 * "1.000.000" stay grouped. Any other edit, such as a deletion inside
 * "1.000", re-parses the display as shown.
 */
export function parseAmountEdit(
  raw: string,
  caret: number,
  edit: { inputType: string; data: string | null },
  locale: string,
): string {
  const { group, decimal } = separatorsFor(locale);
  if (group !== ".") return parseAmountInput(raw, locale);
  if (edit.inputType === "insertText" && edit.data === "." && raw[caret - 1] === ".") {
    return parseAmountInput(`${raw.slice(0, caret - 1)}${decimal}${raw.slice(caret)}`, locale);
  }
  if (edit.inputType === "insertFromPaste" && !raw.includes(decimal)) {
    const dots = raw.split(".").length - 1;
    const after = raw.split(".")[1] ?? "";
    if (dots === 1 && /^\d{0,2}$|^\d{4,}$/.test(after)) return parseAmountInput(raw.replace(".", decimal), locale);
  }
  return parseAmountInput(raw, locale);
}

/** Shows a canonical amount with the locale's grouping and decimal separators; the fraction is kept as typed. */
export function formatAmountInput(canonical: string, locale: string): string {
  const { group, decimal } = separatorsFor(locale);
  const [integer = "", fraction] = canonical.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return fraction === undefined ? grouped : `${grouped}${decimal}${fraction}`;
}

/** The caret offset in `display` that follows `count` digits and decimal points. */
export function caretAfter(display: string, count: number, locale: string): number {
  if (count <= 0) return 0;
  const { decimal } = separatorsFor(locale);
  let seen = 0;
  for (let i = 0; i < display.length; i += 1) {
    const char = display[i]!;
    if ((char >= "0" && char <= "9") || char === decimal) seen += 1;
    if (seen === count) return i + 1;
  }
  return display.length;
}
