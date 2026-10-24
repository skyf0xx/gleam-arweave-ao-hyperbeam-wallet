import { cn } from "../../primitives/cn";

/**
 * An address's avatar — purely presentational. `svgMarkup` is drawn by
 * the caller (`packages/app/src/account-avatar.ts`, which wraps
 * `@dicebear/core`); this package has no `@dicebear/*` dependency of its
 * own and never reaches a network host.
 *
 * The markup is shown through an `<img>` data URI, never injected into
 * the DOM: an image-loaded SVG can't run script or reach the page, so a
 * bad string can only draw a broken picture.
 */
export interface AccountAvatarProps {
  svgMarkup: string;
  label: string;
  size?: number;
  className?: string;
}

/** A cut-gem outline: Gleam's avatars are facets, not tiles. */
const FACETED = "polygon(50% 0%, 79% 10%, 95% 35%, 95% 65%, 79% 90%, 50% 100%, 21% 90%, 5% 65%, 5% 35%, 21% 10%)";

export function AccountAvatar({ svgMarkup, label, size = 28, className }: AccountAvatarProps) {
  return (
    // clip-path would cut a CSS border off, so the border is the outer gem
    // showing around a second gem 1px smaller, with a thin gap inside it.
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex shrink-0 bg-line p-px", className)}
      style={{ width: size, height: size, clipPath: FACETED }}
    >
      <span
        className="block h-full w-full overflow-hidden bg-background"
        style={{ clipPath: FACETED, padding: Math.max(1, Math.round(size * 0.05)) }}
      >
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`}
          alt=""
          draggable={false}
          className="block h-full w-full"
          style={{ clipPath: FACETED }}
        />
      </span>
    </span>
  );
}
