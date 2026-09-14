import { cn } from "../../primitives/cn";

/**
 * The account pill's identity avatar (wallet-main-screen.html's
 * `.account-pill` avatar slot) — purely presentational. `svgMarkup` is
 * pre-generated, locally-rendered SVG source the caller supplies (see
 * `apps/extension/entrypoints/popup/main-screen/src/generateAccountAvatar.ts`,
 * which wraps `@dicebear/core` + `@dicebear/styles`); this component never
 * calls a generator or a network host itself. Kept in `packages/ui`
 * without a `@dicebear/*` dependency of its own — that package only
 * declares `react`/styling primitives, matching every other component
 * here — so the actual generation stays in `apps/extension`, the one
 * workspace `@dicebear/*` was added to.
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
      className={cn("inline-flex flex-shrink-0 overflow-hidden rounded-full bg-mist", className)}
      style={{ width: size, height: size }}
      // eslint-disable-next-line react/no-danger -- `svgMarkup` is generated
      // locally by dicebear from the account address, never from
      // untrusted/remote input (see this file's doc comment).
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
