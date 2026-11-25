import { useT } from "@gleam/app/src/i18n/index.tsx";

/** The bar under a scanner, filled to the share of the animated QR read so far. */
export function ScanProgress({ percent }: { percent: number }) {
  const t = useT();
  return (
    <div
      role="progressbar"
      aria-label={t("extension.scanProgress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1 w-full overflow-hidden rounded-full bg-mist"
    >
      <div className="h-full bg-foreground transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}
