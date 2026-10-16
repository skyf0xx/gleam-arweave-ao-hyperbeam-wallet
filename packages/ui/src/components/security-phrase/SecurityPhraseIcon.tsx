import { cn } from "../../primitives/cn";

export interface SecurityPhraseIconProps {
  /** The icon's SVG source, drawn by the caller. Without it, an empty outline holds the space. */
  svgMarkup?: string;
  size: number;
  className?: string;
}

/**
 * The phrase's icon. The markup is shown through an `<img>` data URI,
 * never injected into the DOM, so a bad string can only draw a broken
 * picture.
 */
export function SecurityPhraseIcon({ svgMarkup, size, className }: SecurityPhraseIconProps) {
  return (
    <span aria-hidden="true" className={cn("inline-flex flex-shrink-0", className)} style={{ width: size, height: size }}>
      {svgMarkup ? (
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`}
          alt=""
          draggable={false}
          className="block h-full w-full"
        />
      ) : (
        <span className="m-[12%] block flex-1 rounded-full border-[1.5px] border-dashed border-line" />
      )}
    </span>
  );
}
