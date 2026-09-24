/**
 * Formats a Winston atomic-integer string as an AR display string
 * (1 AR = 10^12 Winston), using `BigInt` arithmetic throughout so no
 * amount ever passes through a floating-point `Number` conversion. This
 * is the one point where a Winston string becomes a human display
 * string — the value itself is never stored, compared, or summed as a
 * float anywhere else.
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
 * arbitrary decimal-places `denomination` instead of AR's fixed 12, so a
 * token's own smallest-unit quantity never renders as a raw, unscaled
 * integer.
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

/** Same `Intl`-backed USD format as `PortfolioChart`'s own private `formatUsd`. */
export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function isValidArweaveAddress(address: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(address);
}

/**
 * A `ticker` that is really an Arweave/AO process id (unregistered
 * tokens have no other source for a symbol — see `ao/balance.ts`)
 * shortens to a `abcd…wxyz` display form rather than showing the full
 * 43-char address as if it were the token's name.
 */
export function displayTicker(ticker: string): string {
  return isValidArweaveAddress(ticker) ? `${ticker.slice(0, 4)}…${ticker.slice(-4)}` : ticker;
}
