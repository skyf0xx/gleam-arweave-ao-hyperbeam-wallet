import { listSurfaceFunctions, type SurfaceFunction } from "@gleam/core/src/scan/index.ts";

export const TEST_REPO = "owner/repo";
export const COMMIT = "c".repeat(40);

/** The sha of the n-th annotated tag object over a commit: distinct, so the client has to dereference it. */
const tagObjectSha = (commit: string, level: number) => `${"efab9"[level]}${commit.slice(1)}`;

function guard(name: string, kind: "number" | "string"): string {
  return `export function ${name}(value: ${kind}): ${kind} {
  if (!value) {
    throw new Error("${name} refused");
  }
  return value;
}
`;
}

/** Three scannable surface files with two checking functions each, plus files the surface must skip. */
export function surfaceFilesFor(variant = ""): Record<string, string> {
  return {
    "security/surface.txt": "1 src/a.ts\n2 lib/\n5 package.json\n",
    "src/a.ts": `${guard(`guardA1${variant}`, "number")}\n${guard("guardA2", "string")}\nexport function plain(): number {\n  return 1;\n}\n`,
    "lib/b.ts": `${guard("guardB1", "number")}\n${guard("guardB2", "string")}`,
    "lib/c.ts": `${guard("guardC1", "number")}\n${guard("guardC2", "string")}`,
    "lib/c.test.ts": guard("guardTest", "number"),
    "lib/notes.md": "# notes\n",
    "package.json": "{}\n",
    "src/outside.ts": guard("outsideSurface", "number"),
  };
}

export interface FakeRelease {
  commit: string;
  files: Record<string, string>;
  /** Annotated tag objects stacked over the commit; 0 makes the tag lightweight. Defaults to 1. */
  tagObjects?: number;
}

export interface FakeGithub {
  fetch: typeof fetch;
  /** Every URL requested, in order. */
  calls: string[];
  /** The tag name `releases/latest` reports; null answers 404. */
  latest: string | null;
  releases: Record<string, FakeRelease>;
  /** When set, every request answers this status. */
  failWith: number | null;
  /** When true, requests never answer; they reject only when their signal aborts. */
  hang: boolean;
  /** The authorization header of each request, by URL. */
  authorization: Map<string, string | undefined>;
}

/** A stubbed GitHub serving releases `v<x.y.z>`, each an annotated tag over a commit. */
export function fakeGithub(releases: Record<string, FakeRelease>, latest: string | null): FakeGithub {
  const state: FakeGithub = { fetch: undefined as never, calls: [], latest, releases, failWith: null, hang: false, authorization: new Map() };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const notFound = () => new Response("{}", { status: 404 });

  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    state.calls.push(url);
    state.authorization.set(url, (init?.headers as Record<string, string> | undefined)?.authorization);
    if (state.hang) {
      await new Promise<never>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    if (state.failWith !== null) return new Response("{}", { status: state.failWith });
    const prefix = `https://api.github.com/repos/${TEST_REPO}/`;
    if (url === `${prefix}releases/latest`) return state.latest ? json({ tag_name: state.latest }) : notFound();

    const ref = /git\/ref\/tags\/v(.+)$/.exec(url);
    if (url.startsWith(prefix) && ref) {
      const release = state.releases[ref[1]!];
      if (!release) return notFound();
      const depth = release.tagObjects ?? 1;
      return json({ object: depth === 0 ? { type: "commit", sha: release.commit } : { type: "tag", sha: tagObjectSha(release.commit, 0) } });
    }
    const tag = /git\/tags\/([0-9a-f]{40})$/.exec(url);
    if (url.startsWith(prefix) && tag) {
      for (const release of Object.values(state.releases)) {
        const depth = release.tagObjects ?? 1;
        for (let level = 0; level < depth; level++) {
          if (tagObjectSha(release.commit, level) !== tag[1]) continue;
          return json({
            object: level + 1 === depth ? { type: "commit", sha: release.commit } : { type: "tag", sha: tagObjectSha(release.commit, level + 1) },
          });
        }
      }
      return notFound();
    }
    const tree = /git\/trees\/([0-9a-f]{40})\?recursive=1$/.exec(url);
    if (url.startsWith(prefix) && tree) {
      const found = Object.values(state.releases).find((r) => r.commit === tree[1]);
      if (!found) return notFound();
      return json({
        truncated: false,
        tree: Object.entries(found.files).map(([path, text]) => ({ path, type: "blob", size: Buffer.byteLength(text) })),
      });
    }
    const raw = new RegExp(`^https://raw.githubusercontent.com/${TEST_REPO}/([0-9a-f]{40})/(.+)$`).exec(url);
    if (raw) {
      const text = Object.values(state.releases).find((r) => r.commit === raw[1])?.files[decodeURIComponent(raw[2]!)];
      return text === undefined ? notFound() : new Response(text, { status: 200 });
    }
    return notFound();
  }) as typeof fetch;
  return state;
}

/** The functions a challenge can name in `files`. */
export function functionsOf(files: Record<string, string>): SurfaceFunction[] {
  const wanted = ["src/a.ts", "lib/b.ts", "lib/c.ts"];
  return listSurfaceFunctions(wanted.map((path) => ({ path, text: files[path]! })));
}
