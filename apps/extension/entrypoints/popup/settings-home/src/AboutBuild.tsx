import { commitUrl, releaseUrl } from "@/src/site-pages";

export interface AboutBuildProps {
  version: string;
  /** Full sha, or "unknown" when the build had no git checkout to read. */
  commit: string;
}

/** Lets a user match the installed build to a public release and commit. */
export function AboutBuild({ version, commit }: AboutBuildProps) {
  const known = /^[0-9a-f]{40}$/.test(commit);
  return (
    <div className="flex flex-col gap-1 px-4 pt-3 text-caption text-muted">
      <div className="flex items-center justify-between gap-3">
        <span>Version {version}</span>
        <a href={releaseUrl(version)} target="_blank" rel="noreferrer" className="text-foreground underline">
          View release
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
