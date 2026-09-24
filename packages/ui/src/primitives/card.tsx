import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * The bordered list container used for grouped rows and lists.
 * Presentational only — divides its children with a top border and lets
 * each child (typically `ListRow`) own its own bottom border.
 */
export interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return <div className={cn("border-t border-line bg-background", className)}>{children}</div>;
}

/**
 * A single row inside a `Card`. Renders as a `<button>` when `onClick`
 * is supplied, a plain `<div>` otherwise (a non-interactive list item).
 */
export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  start?: ReactNode;
  end?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ListRow({ title, subtitle, start, end, onClick, className }: ListRowProps) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 text-left last:border-b-0",
        onClick && "cursor-pointer hover:bg-mist",
        className,
      )}
    >
      {start}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-label font-semibold text-foreground">{title}</div>
        {subtitle ? <div className="truncate font-mono text-caption text-muted">{subtitle}</div> : null}
      </div>
      {end ? <div className="flex flex-shrink-0 flex-col items-end gap-0.5">{end}</div> : null}
    </Comp>
  );
}
