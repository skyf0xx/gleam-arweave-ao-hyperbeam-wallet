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
