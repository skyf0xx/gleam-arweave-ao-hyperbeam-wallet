import { cn } from "../../primitives/cn";

/**
 * An address's avatar — purely presentational. `svgMarkup` is drawn by
 * the caller (`apps/extension/src/account-avatar.ts`, which wraps
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

export function AccountAvatar({ svgMarkup, label, size = 28, className }: AccountAvatarProps) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex shrink-0 overflow-hidden rounded-[30%] bg-mist", className)}
      style={{ width: size, height: size }}
    >
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`}
        alt=""
        draggable={false}
        className="block h-full w-full"
      />
    </span>
  );
}
