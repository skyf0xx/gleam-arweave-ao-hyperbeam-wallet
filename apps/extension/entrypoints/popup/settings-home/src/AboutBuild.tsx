import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, ScanStats } from "@gleam/core";
import { releaseUrl, sitePageUrl } from "@/src/site-pages";

const SCAN_STATS_STALE_MS = 10 * 60_000;

export interface AboutBuildProps {
  runtime: RuntimePort;
  version: string;
}

/** Lets a user match the installed build to a public release. */
export function AboutBuild({ runtime, version }: AboutBuildProps) {
  const scanStats = useQuery({
    queryKey: ["scans", "stats"],
    queryFn: () => runtime.send<undefined, ScanStats | null>({ type: "getScanStats", payload: undefined }),
    staleTime: SCAN_STATS_STALE_MS,
    retry: false,
  });
  const count = scanStats.data?.total;
  return (
    <div className="flex flex-col gap-1 px-4 pt-3 text-caption text-muted">
      <div className="flex items-center justify-between gap-3">
        <span>Version {version}</span>
        <a href={releaseUrl(version)} target="_blank" rel="noreferrer" className="text-foreground underline">
          View release
        </a>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>Community audits</span>
        <a href={sitePageUrl("scan-results", version)} target="_blank" rel="noreferrer" className="text-foreground underline">
          {typeof count === "number" ? `${count} ${count === 1 ? "audit" : "audits"} →` : "View audits →"}
        </a>
      </div>
    </div>
  );
}
