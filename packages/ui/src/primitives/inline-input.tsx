import * as React from "react";
import { cn } from "./cn";

/** A compact underlined input with no label, for editing a value in place of its row. */
export const InlineInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "border-0 border-b border-line bg-transparent px-0 py-2.5 text-label text-foreground focus:outline-none",
        className,
      )}
      {...props}
    />
  ),
);
InlineInput.displayName = "InlineInput";
