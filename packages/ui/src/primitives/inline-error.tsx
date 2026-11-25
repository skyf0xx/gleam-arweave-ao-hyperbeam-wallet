import type { ReactNode } from "react";
import { cn } from "./cn";

const SIZE_CLASS = {
  label: "text-label leading-snug text-warning",
  caption: "text-caption text-warning",
} as const;

export interface InlineErrorProps {
  size?: keyof typeof SIZE_CLASS;
  /** The element to render; the error sits in a paragraph, a block or a line of text. */
  as?: "p" | "div" | "span";
  className?: string;
  children: ReactNode;
}

/** An error announced in place, under the field or row it belongs to. */
export function InlineError({ size = "caption", as: Tag = "p", className, children }: InlineErrorProps) {
  return (
    <Tag role="alert" className={cn(SIZE_CLASS[size], className)}>
      {children}
    </Tag>
  );
}
