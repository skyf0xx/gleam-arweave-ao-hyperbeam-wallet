interface Separators {
  group: string;
  decimal: string;
}

function separatorsFor(locale: string): Separators {
  const parts = new Intl.NumberFormat(locale).formatToParts(1000.5);
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

/** Shows a canonical amount with the locale's grouping and decimal separators; the fraction is kept as typed. */
export function formatAmountInput(canonical: string, locale: string): string {
  const { group, decimal } = separatorsFor(locale);
  const [integer = "", fraction] = canonical.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return fraction === undefined ? grouped : `${grouped}${decimal}${fraction}`;
}

/** How many digits and decimal points sit before `caret`, to find the same spot after reformatting. */
export function significantBefore(display: string, caret: number, locale: string): number {
  const { group, decimal } = separatorsFor(locale);
  let count = 0;
  for (const char of display.slice(0, caret)) {
    if ((char >= "0" && char <= "9") || (char !== group && (char === decimal || char === "." || char === ","))) count += 1;
  }
  return count;
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
