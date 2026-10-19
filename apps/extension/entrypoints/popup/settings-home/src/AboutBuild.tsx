import { useQuery } from "@tanstack/react-query";
import type { RuntimePort } from "@gleam/core";
import { commitUrl, releaseUrl, sitePageUrl } from "@/src/site-pages";

const SCAN_COUNT_STALE_MS = 10 * 60_000;

export interface AboutBuildProps {
  runtime: RuntimePort;
  version: string;
  /** Full sha, or "unknown" when the build had no git checkout to read. */
  commit: string;
}

/** Lets a user match the installed build to a public release and commit. */
export function AboutBuild({ runtime, version, commit }: AboutBuildProps) {
  const scanCount = useQuery({
    queryKey: ["scans", "count", version],
    queryFn: () => runtime.send<undefined, number | null>({ type: "getScanCount", payload: undefined }),
    staleTime: SCAN_COUNT_STALE_MS,
    retry: false,
  });
  const count = scanCount.data;
  const known = /^[0-9a-f]{40}$/.test(commit);
  return (
    <div className="flex flex-col gap-1 px-4 pt-3 text-caption text-muted">
      <div className="flex items-center justify-between gap-3">
        <span>Version {version}</span>
        <a href={releaseUrl(version)} target="_blank" rel="noreferrer" className="text-foreground underline">
          View release
        </a>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>Community scans</span>
        <a href={sitePageUrl("scan", version)} target="_blank" rel="noreferrer" className="text-foreground underline">
          {typeof count === "number" ? `${count} ${count === 1 ? "scan" : "scans"} →` : "View scans →"}
        </a>
      </div>
      {known ? (
        <div className="flex items-center justify-between gap-3">
          <span>Commit</span>
          <a
            href={commitUrl(commit)}
            target="_blank"
            rel="noreferrer"
            title={commit}
            className="font-mono text-foreground underline"
          >
            {commit.slice(0, 7)}
          </a>
        </div>
      ) : null}
    </div>
  );
}
