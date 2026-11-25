import { useState, type ReactNode } from "react";
import { ChevronIcon } from "@gleam/ui/src/primitives/chevron-icon.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { useT } from "../../../i18n";
import { usePlatform } from "../../../app-platform/context";
import { gleamUrl, howItWorksUrl } from "./JoinNote";

/**
 * The footer, folded so nothing competes with the screen's one action.
 * Opened, the two reading links lead and anything passed in (Leave) sits
 * apart below them, quieter.
 */
export function AboutPoints({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const { version } = usePlatform().buildInfo;
  const [open, setOpen] = useState(false);

  return (
    <footer className={cn("flex flex-col items-center gap-3", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="points-about"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-caption text-muted hover:text-foreground phone:min-h-11"
      >
        {t("points.about")}
        <ChevronIcon open={open} />
      </button>
      {open ? (
        <div id="points-about" className="flex w-full flex-col gap-4">
          <ul className="flex flex-col gap-6">
            <AboutLink
              href={howItWorksUrl(version)}
              title={t("points.howToEarn")}
              detail={t("points.howToEarnDetail")}
            />
            <AboutLink
              href={gleamUrl(version)}
              title={t("points.future")}
              detail={t("points.futureDetail")}
            />
          </ul>
          {children ? (
            <div className="flex justify-center">{children}</div>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}

function AboutLink({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 hover:bg-hover phone:-mx-3 phone:px-3"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-label font-semibold text-foreground">
            {title}
          </span>
          <span className="text-caption text-muted">{detail}</span>
        </span>
        <span aria-hidden="true" className="text-muted">
          ↗
        </span>
      </a>
    </li>
  );
}
