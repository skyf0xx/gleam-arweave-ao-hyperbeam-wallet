/** 100 AR (or AO) in atomic units: the balance up to which points are linear. */
export const CURVE_KNEE_ATOMIC = 100n * 10n ** 12n;

/** Floor of the square root, by Newton's method. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of a negative number.");
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

/**
 * Daily points for a combined AR + AO balance (POINTS.md § Rules → Whale
 * curve): linear up to the knee, then `2·√(T·x) − T`, which meets the line
 * there with the same slope. `T·x` is in atomic², so the root is atomic.
 */
export function curve(atomic: bigint): bigint {
  if (atomic <= CURVE_KNEE_ATOMIC) return atomic;
  return 2n * isqrt(CURVE_KNEE_ATOMIC * atomic) - CURVE_KNEE_ATOMIC;
}
