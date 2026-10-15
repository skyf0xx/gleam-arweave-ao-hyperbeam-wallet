const ATOMIC_PER_POINT = 10n ** 12n;

/**
 * Points are atomic integers with 12 decimals (POINTS.md § Rules). Below
 * 1,000 two decimals are shown so a small balance visibly ticks; above
 * that, whole points.
 */
export function formatPoints(atomic: string): string {
  const value = BigInt(atomic);
  const whole = value / ATOMIC_PER_POINT;
  if (whole >= 1000n) return whole.toLocaleString("en-US");
  const hundredths = (value % ATOMIC_PER_POINT) / (ATOMIC_PER_POINT / 100n);
  return `${whole.toLocaleString("en-US")}.${hundredths.toString().padStart(2, "0")}`;
}

const COMPACT_UNITS: ReadonlyArray<readonly [bigint, string]> = [
  [10n ** 9n, "B"],
  [10n ** 6n, "M"],
  [10n ** 3n, "K"],
];

/**
 * Short form for tight spots such as the token row: "194.2K", "2.3M".
 * Below 1,000 it matches `formatPoints`. It truncates rather than rounds,
 * so it never shows more points than the wallet has (999,999 is "999.9K",
 * not "1000.0K").
 */
export function formatPointsCompact(atomic: string): string {
  const whole = BigInt(atomic) / ATOMIC_PER_POINT;
  for (const [size, suffix] of COMPACT_UNITS) {
    if (whole < size) continue;
    const tenths = (whole * 10n) / size;
    const fraction = tenths % 10n;
    return `${(tenths / 10n).toLocaleString("en-US")}${fraction === 0n ? "" : `.${fraction}`}${suffix}`;
  }
  return formatPoints(atomic);
}
