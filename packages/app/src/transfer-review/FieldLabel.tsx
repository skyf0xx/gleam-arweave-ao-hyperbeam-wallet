import type { ReactNode } from "react";
import { cn } from "@gleam/ui/src/primitives/cn.ts";

/** The small uppercase caption above a field or section of a review. */
export function FieldLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("text-caption font-semibold uppercase tracking-wide text-muted", className)}>{children}</span>
  );
}

/** A `FieldLabel` stacked over the value it names. */
export function Field({ label, className, children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}
