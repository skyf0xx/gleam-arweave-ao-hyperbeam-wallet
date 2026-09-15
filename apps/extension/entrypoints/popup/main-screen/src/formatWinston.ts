/**
 * Formats a Winston atomic-integer string as an AR display string
 * (1 AR = 10^12 Winston), using `BigInt` arithmetic throughout so no
 * amount ever passes through a floating-point `Number` conversion
 * (RELEVANT RULES: "AR balance is read ... and rendered without float
 * conversion (Winston as atomic-integer strings throughout"). This is
 * the one point where a Winston string becomes a human display string —
 * the value itself is never stored, compared, or summed as a float
 * anywhere in this build.
 */
const WINSTON_PER_AR = 1_000_000_000_000n;

export function formatWinstonAsAr(winston: string, maxFractionDigits = 4): string {
  if (!/^\d+$/.test(winston)) return "—";

  const amount = BigInt(winston);
  const whole = amount / WINSTON_PER_AR;
  const remainder = amount % WINSTON_PER_AR;

  if (remainder === 0n) return whole.toString();

  const fractionDigits = 12;
  const fractionStr = remainder.toString().padStart(fractionDigits, "0");
  const trimmed = fractionStr.slice(0, maxFractionDigits).replace(/0+$/, "");

  return trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : whole.toString();
}

/**
 * The AO-token equivalent of `formatWinstonAsAr`, generalized over an
 * arbitrary decimal-places `denomination` instead of AR's fixed 12 —
 * mirrors `SendView.tsx`'s private `formatAtomicAsDisplay` (same
 * BigInt-only algorithm) so a token's own smallest-unit quantity never
 * renders as a raw, unscaled integer.
 */
export function formatAtomicAsDisplay(atomic: string, denomination: number, maxFractionDigits = 4): string {
  if (!/^\d+$/.test(atomic)) return "—";
  if (denomination === 0) return atomic;

  const unit = 10n ** BigInt(denomination);
  const amount = BigInt(atomic);
  const whole = amount / unit;
  const remainder = amount % unit;

  if (remainder === 0n) return whole.toString();

  const fractionStr = remainder.toString().padStart(denomination, "0");
  const trimmed = fractionStr.slice(0, Math.min(maxFractionDigits, denomination)).replace(/0+$/, "");

  return trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : whole.toString();
}

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
