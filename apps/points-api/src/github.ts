import {
  MAX_SCAN_FILE_BYTES,
  RELEASE_PATTERN,
  isScannablePath,
  listSurfaceFunctions,
  parseSurfaceText,
  surfaceFiles,
  type SurfaceFunction,
} from "@gleam/core/src/scan/index.ts";

export const DEFAULT_GITHUB_REPO = "skyf0xx/gleam-arweave-ao-hyperbeam-wallet";

export interface Release {
  /** `x.y.z`, the tag without its `v`. */
  release: string;
  /** The commit the tag points at. */
  commit: string;
}

/** The security-surface files at a commit, read once and kept. */
export interface ReleaseFiles {
  files: ReadonlyMap<string, string>;
  /** Every function a challenge may name, and the coverage denominator. */
  functions: readonly SurfaceFunction[];
}

export interface GithubClient {
  /** The newest published, non-draft, non-prerelease release; null when there is none. */
  latestRelease(): Promise<Release | null>;
  /** The commit a release's tag points at; null when the tag doesn't exist. */
  releaseCommit(release: string): Promise<string | null>;
  filesAt(commit: string): Promise<ReleaseFiles>;
}

/** GitHub didn't answer usefully; the request can be retried later. */
export class GithubUnavailableError extends Error {}

export interface GithubClientOptions {
  fetchImpl?: typeof fetch;
  repo?: string;
  token?: string;
  now?: () => number;
  /** Per request. */
  requestTimeoutMs?: number;
  /** For reading all of a commit's files. */
  loadTimeoutMs?: number;
}

/** How long answers and failures are remembered; also what callers tell clients to wait. */
export const GITHUB_RETRY_SECONDS = 60;
const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = GITHUB_RETRY_SECONDS * 1000;
/** An expired answer is still served this long while GitHub fails. */
const STALE_GRACE_MS = 10 * 60_000;
const MAX_CACHED_COMMITS = 4;
const MAX_CACHED_RELEASES = 32;
const MAX_TOTAL_BYTES = 20_000_000;
const FILE_CONCURRENCY = 8;
const MAX_TAG_DEPTH = 3;
const SHA = /^[0-9a-f]{40}$/;
const API = "https://api.github.com";

/**
 * Answers keyed by name, with three rules that keep one slow or failing
 * GitHub from using up its unauthenticated quota (60 an hour):
 * concurrent loads of a key share one request; a failure (or a `ttl`
 * shorter than the success one, such as a 404) is remembered for a minute,
 * during which an answer that expired less than ten minutes ago is served
 * instead; and the oldest-used entries go first once `max` is reached,
 * except a pinned key.
 */
class Memo<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly failures = new Map<string, { error: Error; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<T>>();

  constructor(
    private readonly now: () => number,
    private readonly max: number,
    private readonly ttl: (value: T) => number,
    private readonly pinned: () => string | undefined = () => undefined,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const at = this.now();
    const hit = this.entries.get(key);
    if (hit && at < hit.expiresAt) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return Promise.resolve(hit.value);
    }
    const stale = hit && at < hit.expiresAt + STALE_GRACE_MS ? { value: hit.value } : undefined;
    const failed = this.failures.get(key);
    if (failed && at < failed.expiresAt) return stale ? Promise.resolve(stale.value) : Promise.reject(failed.error);

    let loading = this.pending.get(key);
    if (!loading) {
      loading = load().then(
        (value) => {
          this.failures.delete(key);
          this.entries.delete(key);
          this.entries.set(key, { value, expiresAt: this.now() + this.ttl(value) });
          this.evict();
          return value;
        },
        (error: unknown) => {
          this.failures.set(key, { error: error as Error, expiresAt: this.now() + NEGATIVE_TTL_MS });
          if (stale) return stale.value;
          throw error;
        },
      );
      this.pending.set(key, loading);
      const done = () => this.pending.delete(key);
      loading.then(done, done);
    }
    return loading;
  }

  private evict(): void {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.max) return;
      if (key !== this.pinned()) this.entries.delete(key);
    }
  }
}

export function createGithubClient(options: GithubClientOptions = {}): GithubClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const repo = options.repo ?? DEFAULT_GITHUB_REPO;
  const now = options.now ?? Date.now;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const loadTimeoutMs = options.loadTimeoutMs ?? 60_000;

  async function get(url: string, signal?: AbortSignal): Promise<Response> {
    // The token goes to the API only; raw.githubusercontent.com needs none for a public repo.
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "gleam-points-api",
      ...(options.token && url.startsWith(`${API}/`) ? { authorization: `Bearer ${options.token}` } : {}),
    };
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    try {
      return await fetchImpl(url, { headers, signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
    } catch (cause) {
      throw new GithubUnavailableError(`GitHub request failed: ${String(cause)}`);
    }
  }

  async function api<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    const response = await get(`${API}/repos/${repo}/${path}`, signal);
    if (response.status === 404) return null;
    if (!response.ok) throw new GithubUnavailableError(`GitHub answered ${response.status} for ${path}.`);
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new GithubUnavailableError(`GitHub sent unreadable JSON for ${path}: ${String(cause)}`);
    }
  }

  // Annotated tags (the release script signs them) point at a tag object,
  // which points at the commit; a lightweight tag points at the commit.
  async function resolveTag(release: string): Promise<string | null> {
    type Ref = { object?: { type?: string; sha?: string } };
    let ref = await api<Ref>(`git/ref/tags/v${release}`);
    for (let depth = 0; ref?.object && depth <= MAX_TAG_DEPTH; depth++) {
      const { type, sha } = ref.object;
      if (typeof sha !== "string" || !SHA.test(sha)) break;
      if (type === "commit") return sha;
      if (type !== "tag") break;
      ref = await api<Ref>(`git/tags/${sha}`);
    }
    if (ref === null) return null;
    throw new GithubUnavailableError(`The tag v${release} doesn't resolve to a commit.`);
  }

  // The latest release's commit and files are never evicted, so listing an
  // old release can't push out what challenges and submissions need.
  let latestCommit: string | undefined;
  let latestReleaseName: string | undefined;

  const commits = new Memo<string | null>(now, MAX_CACHED_RELEASES, (commit) => (commit ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS), () => latestReleaseName);
  const latestMemo = new Memo<Release | null>(now, 1, (value) => (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS));
  const files = new Memo<ReleaseFiles>(now, MAX_CACHED_COMMITS, () => Infinity, () => latestCommit);

  async function loadLatest(): Promise<Release | null> {
    const found = await api<{ tag_name?: unknown }>("releases/latest");
    const match = typeof found?.tag_name === "string" ? /^v(.+)$/.exec(found.tag_name) : null;
    if (!match || !RELEASE_PATTERN.test(match[1]!)) return null;
    const commit = await client.releaseCommit(match[1]!);
    if (!commit) return null;
    latestReleaseName = match[1]!;
    latestCommit = commit;
    return { release: match[1]!, commit };
  }

  async function loadFiles(commit: string): Promise<ReleaseFiles> {
    const deadline = AbortSignal.timeout(loadTimeoutMs);
    const raw = async (path: string, maxBytes: number): Promise<string> => {
      const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
      const response = await get(url, deadline);
      if (!response.ok) throw new GithubUnavailableError(`GitHub answered ${response.status} for ${path}.`);
      const text = await response.text();
      if (new TextEncoder().encode(text).length > maxBytes) throw new GithubUnavailableError(`${path} is larger than the scan reads.`);
      return text;
    };

    const tree = await api<{ tree?: { path: string; type: string; size?: number }[]; truncated?: boolean }>(
      `git/trees/${commit}?recursive=1`,
      deadline,
    );
    if (!tree?.tree || tree.truncated) throw new GithubUnavailableError("GitHub couldn't list the repository tree.");
    const blobs = new Map(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.size ?? 0]));

    const surfaceSize = blobs.get("security/surface.txt");
    if (surfaceSize === undefined) throw new GithubUnavailableError("The commit has no security/surface.txt.");
    if (surfaceSize > MAX_SCAN_FILE_BYTES) throw new GithubUnavailableError("security/surface.txt is larger than the scan reads.");
    let entries;
    try {
      entries = parseSurfaceText(await raw("security/surface.txt", MAX_SCAN_FILE_BYTES));
    } catch (cause) {
      if (cause instanceof GithubUnavailableError) throw cause;
      throw new GithubUnavailableError(`security/surface.txt is malformed: ${String(cause)}`);
    }

    // A file over the cap is left out; no challenge names it.
    const wanted = surfaceFiles(entries, [...blobs.keys()].filter(isScannablePath)).filter(
      (path) => blobs.get(path)! <= MAX_SCAN_FILE_BYTES,
    );
    if (wanted.reduce((total, path) => total + blobs.get(path)!, 0) > MAX_TOTAL_BYTES) {
      throw new GithubUnavailableError("The security surface is larger than the scan reads.");
    }

    const texts = new Map<string, string>();
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(FILE_CONCURRENCY, wanted.length) }, async () => {
        while (next < wanted.length) {
          const path = wanted[next++]!;
          texts.set(path, await raw(path, MAX_SCAN_FILE_BYTES));
        }
      }),
    );
    try {
      return { files: texts, functions: listSurfaceFunctions(wanted.map((path) => ({ path, text: texts.get(path)! }))) };
    } catch (cause) {
      throw new GithubUnavailableError(`The surface files couldn't be read: ${String(cause)}`);
    }
  }

  const client: GithubClient = {
    latestRelease: () => latestMemo.get("latest", loadLatest),
    async releaseCommit(release) {
      if (!RELEASE_PATTERN.test(release)) return null;
      return commits.get(release, () => resolveTag(release));
    },
    async filesAt(commit) {
      if (!SHA.test(commit)) throw new Error(`"${commit}" isn't a 40-character commit sha.`);
      return files.get(commit, () => loadFiles(commit));
    },
  };
  return client;
}
