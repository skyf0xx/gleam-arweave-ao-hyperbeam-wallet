import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

/**
 * shadcn/ui-derived Button primitive, copied into the tree rather than
 * installed as a package (no runtime style injection, no CSP nonce
 * problem).
 *
 * Variants follow the risk-tier system:
 * - `primary` — black/white, the only variant used for a screen's one
 *   primary action.
 * - `secondary` — white background, thin border, black text.
 * - `ghost` — icon-button-weight, no border, for low-emphasis actions.
 * - `destructive` — the single warning-red accent, reserved for the
 *   Irreversible-tier primary action only (e.g. "Reset wallet", a
 *   first-seen-address send). Never the beam.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-foreground text-background hover:opacity-85",
        secondary: "border border-line bg-background text-foreground hover:bg-mist",
        ghost: "rounded-md text-muted hover:bg-mist hover:text-foreground",
        destructive: "bg-warning text-white hover:brightness-110",
      },
      size: {
        default: "h-11 w-full px-4 py-3",
        sm: "h-8 px-3 text-xs",
        icon: "h-8 w-8 flex-shrink-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
