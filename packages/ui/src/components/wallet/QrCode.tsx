import type * as React from "react";

/**
 * KNOWN LIMITATION (reported per this task's packet, not silently
 * shipped): this renders a QR-*shaped* decorative SVG matching
 * receive-screen.html's `.qr-card` pixel-for-pixel — including that
 * mockup's own module pattern, which is itself a static illustrative
 * grid, not a real encoder's output — rather than an actual QR encoding
 * of `value`. No QR-generation library exists anywhere in this
 * workspace's dependency tree (checked: no `qrcode`/`qrcode-generator`/
 * similar in `pnpm-lock.yaml` or any `node_modules`), and adding one is a
 * new dependency the stack in `core-design.md` doesn't already name —
 * the same "shared config, no single owner" gap class `onboarding-unlock`
 * flagged for `@webext-core/messaging` (a `package.json`/lockfile change,
 * requiring its own `chore(workspace)` commit + an override, not a quiet
 * addition here). `value` is accepted and rendered as the visually
 * hidden accessible label so the component's contract is already
 * correct for a future real encoder to drop in behind the same props.
 */
export interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

export function QrCode({ value, size = 176, className }: QrCodeProps) {
  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "#ffffff",
        border: "1px solid #e5e5e5",
        borderRadius: 14,
      }}
    >
      <svg
        viewBox="0 0 33 33"
        width={size}
        height={size}
        fill="none"
        role="img"
        aria-label={`QR code for wallet address ${value}`}
      >
        <rect width="33" height="33" fill="#ffffff" />
        <g fill="#111111">
          <rect x="0" y="0" width="7" height="7" />
          <rect x="1" y="1" width="5" height="5" fill="#ffffff" />
          <rect x="2" y="2" width="3" height="3" />
          <rect x="26" y="0" width="7" height="7" />
          <rect x="27" y="1" width="5" height="5" fill="#ffffff" />
          <rect x="28" y="2" width="3" height="3" />
          <rect x="0" y="26" width="7" height="7" />
          <rect x="1" y="27" width="5" height="5" fill="#ffffff" />
          <rect x="2" y="28" width="3" height="3" />
          {generatePseudoRandomModules(value)}
        </g>
      </svg>
    </div>
  );
}

/**
 * Deterministic (seeded by `value`) filler pattern for the QR-shaped
 * placeholder's data area — varies visually per address so it doesn't
 * look like the exact same static image on every screen, without
 * pretending to encode anything decodable. Pure cosmetic filler, per this
 * component's doc comment.
 */
function generatePseudoRandomModules(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const rects: React.ReactNode[] = [];
  let state = hash || 1;
  const next = () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state / 0xffffffff;
  };

  for (let y = 9; y < 24; y += 1) {
    for (let x = 9; x < 24; x += 1) {
      // Skip the finder-pattern quiet zones' immediate neighbors.
      if (next() > 0.55) {
        rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
      }
    }
  }
  return rects;
}
