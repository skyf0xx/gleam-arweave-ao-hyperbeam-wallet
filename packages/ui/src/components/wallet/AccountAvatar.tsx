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
      // svgMarkup is generated locally by dicebear from the account
      // address, never from untrusted/remote input.
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
