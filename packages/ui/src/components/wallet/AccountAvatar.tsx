import { cn } from "../../primitives/cn";

/**
 * The account pill's identity avatar — purely presentational.
 * `svgMarkup` is pre-generated, locally-rendered SVG source the caller
 * supplies (see
 * `apps/extension/entrypoints/popup/main-screen/src/generateAccountAvatar.ts`,
 * which wraps `@dicebear/core` + `@dicebear/styles`); this component
 * never calls a generator or a network host itself. Kept in
 * `packages/ui` without a `@dicebear/*` dependency of its own, so the
 * actual generation stays in `apps/extension`.
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
      className={cn("inline-flex flex-shrink-0 overflow-hidden rounded- bg-mist opacity-30", className)}
      style={{ width: size, height: size, clipPath:  "polygon(50% 0%, 79% 10%, 95% 35%, 95% 65%, 79% 90%, 50% 100%, 21% 90%, 5% 65%, 5% 35%, 21% 10%)" }}
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
