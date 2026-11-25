import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../primitives/cn";

const STEP_COLUMN = "flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6 phone:pb-0";

/** The heading and one paragraph that open a step. */
export function StepIntro({
  title,
  body,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title" | "children"> & { title: ReactNode; body: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...props}>
      <h1 className="text-h3 font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="text-body leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/** The padded column a step's form fills under its header. */
export function StepForm({ className, ...props }: ComponentProps<"form">) {
  return <form className={cn(STEP_COLUMN, className)} {...props} />;
}

/** `StepForm`'s column for a step that isn't a form. */
export function StepColumn({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(STEP_COLUMN, className)} {...props} />;
}
