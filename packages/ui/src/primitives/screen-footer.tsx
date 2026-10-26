import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Holds a screen's primary action. In the popup and side panel it is just
 * a column at the bottom of the screen; on the phone `.gleam-footer`
 * (theme.css) pins it above the bottom inset so the action never falls
 * below the fold. Pass `mt-*` to keep a fixed gap above it in the popup;
 * the phone always bottom-aligns it.
 *
 * `pinned={false}` is for an irreversible action: on the phone the footer
 * then follows the content, so the warning that precedes it is on screen
 * whenever the button is.
 */
export interface ScreenFooterProps {
  children: ReactNode;
  className?: string;
  pinned?: boolean;
}

export function ScreenFooter({ children, className, pinned = true }: ScreenFooterProps) {
  return (
    <div className={cn("gleam-footer mt-auto flex w-full flex-col gap-3 phone:mt-auto phone:w-auto", !pinned && "gleam-footer-flow", className)}>
      {children}
    </div>
  );
}
