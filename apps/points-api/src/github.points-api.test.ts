// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createGithubClient, GithubUnavailableError, type GithubClientOptions } from "./github";
import { COMMIT, TEST_REPO, fakeGithub, functionsOf, surfaceFilesFor, type FakeRelease } from "./test-github";

function setup(latest: string | null = "v1.0.0", extra: Partial<FakeRelease> = {}, options: Partial<GithubClientOptions> = {}) {
  const files = surfaceFilesFor();
  const github = fakeGithub({ "1.0.0": { commit: COMMIT, files, ...extra } }, latest);
  let clock = 0;
  const client = createGithubClient({ fetchImpl: github.fetch, repo: TEST_REPO, now: () => clock, ...options });
  return { files, github, client, advance: (ms: number) => (clock += ms) };
}

describe("github client", () => {
  it("resolves the latest release through the annotated tag to its commit", async () => {
    const { client } = setup();
    expect(await client.latestRelease()).toEqual({ release: "1.0.0", commit: COMMIT });
  });

  it("answers null when there is no release or the tag isn't x.y.z", async () => {
    expect(await setup(null).client.latestRelease()).toBeNull();
    expect(await setup("v1.0.0-rc1").client.latestRelease()).toBeNull();
  });

  it("answers null for a tag that doesn't exist", async () => {
    expect(await setup().client.releaseCommit("9.9.9")).toBeNull();
  });

  it("caches the latest release for five minutes and shares concurrent lookups", async () => {
    const { client, github, advance } = setup();
    await Promise.all([client.latestRelease(), client.latestRelease()]);
    await client.latestRelease();
    const lookups = () => github.calls.filter((url) => url.endsWith("releases/latest")).length;
    expect(lookups()).toBe(1);

    advance(5 * 60_000 + 1);
    await client.latestRelease();
    expect(lookups()).toBe(2);
  });

  it("reads only the scannable surface files and lists their checking functions", async () => {
    const { client, files } = setup();
    const loaded = await client.filesAt(COMMIT);

    expect([...loaded.files.keys()].sort()).toEqual(["lib/b.ts", "lib/c.ts", "src/a.ts"]);
    expect(loaded.functions).toEqual(functionsOf(files));
    expect(loaded.functions.map((fn) => fn.symbol).sort()).toEqual(["guardA1", "guardA2", "guardB1", "guardB2", "guardC1", "guardC2"]);
  });

  it("fetches each commit's files once, even for concurrent requests", async () => {
    const { client, github } = setup();
    await Promise.all([client.filesAt(COMMIT), client.filesAt(COMMIT)]);
    await client.filesAt(COMMIT);

    expect(github.calls.filter((url) => url.includes("git/trees/"))).toHaveLength(1);
    expect(github.calls.filter((url) => url.includes("raw.githubusercontent.com"))).toHaveLength(4);
  });

  it("evicts the least recently used commit but never the latest release's", async () => {
    const releases = Object.fromEntries(
      [1, 2, 3, 4, 5].map((n) => [`1.0.${n}`, { commit: String(n).repeat(40), files: surfaceFilesFor() }]),
    );
    const github = fakeGithub(releases, "v1.0.5");
    const client = createGithubClient({ fetchImpl: github.fetch, repo: TEST_REPO });
    await client.latestRelease();
    const trees = () => github.calls.filter((url) => url.includes("git/trees/")).length;

    // The latest commit is the oldest entry, yet survives while older ones go.
    for (const n of [5, 1, 2, 3, 4]) await client.filesAt(String(n).repeat(40));
    expect(trees()).toBe(5);
    await client.filesAt("5".repeat(40));
    expect(trees()).toBe(5);
    await client.filesAt("1".repeat(40));
    expect(trees()).toBe(6);

    // Touching a commit keeps it.
    await client.filesAt("3".repeat(40));
    await client.filesAt("4".repeat(40));
    await client.filesAt("1".repeat(40));
    await client.filesAt("2".repeat(40));
    expect(trees()).toBe(7);
    await client.filesAt("4".repeat(40));
    await client.filesAt("5".repeat(40));
    expect(trees()).toBe(7);
  });

  it("remembers a failure for a minute, then retries", async () => {
    const { client, github, advance } = setup();
    github.failWith = 500;
    await expect(client.filesAt(COMMIT)).rejects.toBeInstanceOf(GithubUnavailableError);
    await expect(client.latestRelease()).rejects.toBeInstanceOf(GithubUnavailableError);
    const attempts = github.calls.length;

    github.failWith = null;
    await expect(client.filesAt(COMMIT)).rejects.toBeInstanceOf(GithubUnavailableError);
    await expect(client.latestRelease()).rejects.toBeInstanceOf(GithubUnavailableError);
    expect(github.calls.length).toBe(attempts);

    advance(60_000);
    expect((await client.filesAt(COMMIT)).functions).toHaveLength(6);
    expect(await client.latestRelease()).not.toBeNull();
  });

  it("serves an expired answer for ten minutes while GitHub fails", async () => {
    const { client, github, advance } = setup();
    expect(await client.latestRelease()).toEqual({ release: "1.0.0", commit: COMMIT });

    github.failWith = 500;
    advance(5 * 60_000);
    expect(await client.latestRelease()).toEqual({ release: "1.0.0", commit: COMMIT });
    const attempts = github.calls.length;
    // The failure is remembered, so the stale answer comes without another request.
    advance(30_000);
    expect(await client.latestRelease()).toEqual({ release: "1.0.0", commit: COMMIT });
    expect(github.calls.length).toBe(attempts);

    advance(10 * 60_000);
    await expect(client.latestRelease()).rejects.toBeInstanceOf(GithubUnavailableError);
  });

  it("remembers a failure that isn't a network one, such as a malformed surface file", async () => {
    const files = surfaceFilesFor();
    files["security/surface.txt"] = "not a surface line\n";
    const github = fakeGithub({ "1.0.0": { commit: COMMIT, files } }, "v1.0.0");
    const client = createGithubClient({ fetchImpl: github.fetch, repo: TEST_REPO, now: () => 0 });

    await expect(client.filesAt(COMMIT)).rejects.toThrow(/malformed/);
    const attempts = github.calls.length;
    await expect(client.filesAt(COMMIT)).rejects.toThrow(/malformed/);
    expect(github.calls.length).toBe(attempts);
  });

  it("remembers a missing release or tag for a minute", async () => {
    const { client, github, advance } = setup(null);
    expect(await client.latestRelease()).toBeNull();
    expect(await client.releaseCommit("9.9.9")).toBeNull();
    await client.latestRelease();
    await client.releaseCommit("9.9.9");
    expect(github.calls).toHaveLength(2);

    github.latest = "v1.0.0";
    advance(60_000);
    expect(await client.latestRelease()).toEqual({ release: "1.0.0", commit: COMMIT });
  });

  it("follows a lightweight tag straight to its commit", async () => {
    const { client, github } = setup("v1.0.0", { tagObjects: 0 });
    expect(await client.latestRelease()).toEqual({ release: "1.0.0", commit: COMMIT });
    expect(github.calls.some((url) => url.includes("git/tags/"))).toBe(false);
  });

  it("follows nested annotated tags up to three deep and refuses more", async () => {
    expect(await setup("v1.0.0", { tagObjects: 3 }).client.releaseCommit("1.0.0")).toBe(COMMIT);
    await expect(setup("v1.0.0", { tagObjects: 5 }).client.releaseCommit("1.0.0")).rejects.toThrow(/doesn't resolve to a commit/);
  });

  it("picks up a retargeted tag after five minutes", async () => {
    const { client, github, advance } = setup();
    expect(await client.releaseCommit("1.0.0")).toBe(COMMIT);

    github.releases["1.0.0"] = { commit: "b".repeat(40), files: surfaceFilesFor() };
    advance(5 * 60_000 - 1);
    expect(await client.releaseCommit("1.0.0")).toBe(COMMIT);
    advance(1);
    expect(await client.releaseCommit("1.0.0")).toBe("b".repeat(40));
  });

  it("validates a release and a sha before asking GitHub", async () => {
    const { client, github } = setup();
    expect(await client.releaseCommit("../../x")).toBeNull();
    expect(await client.releaseCommit("v1.0.0")).toBeNull();
    await expect(client.filesAt("main")).rejects.toThrow(/40-character/);
    expect(github.calls).toHaveLength(0);
  });

  it("gives up on a hung request, then on a hung load, and doesn't keep either", async () => {
    const hungRequest = setup("v1.0.0", {}, { requestTimeoutMs: 20 });
    hungRequest.github.hang = true;
    await expect(hungRequest.client.latestRelease()).rejects.toBeInstanceOf(GithubUnavailableError);

    const hungLoad = setup("v1.0.0", {}, { loadTimeoutMs: 20 });
    hungLoad.github.hang = true;
    await expect(hungLoad.client.filesAt(COMMIT)).rejects.toBeInstanceOf(GithubUnavailableError);
    hungLoad.github.hang = false;
    hungLoad.advance(60_000);
    expect((await hungLoad.client.filesAt(COMMIT)).functions).toHaveLength(6);
  });

  it("sends the token to the API only", async () => {
    const files = surfaceFilesFor();
    const github = fakeGithub({ "1.0.0": { commit: COMMIT, files } }, "v1.0.0");
    const client = createGithubClient({ fetchImpl: github.fetch, repo: TEST_REPO, token: "secret" });
    await client.filesAt(COMMIT);

    expect(github.authorization.size).toBeGreaterThan(2);
    for (const [url, authorization] of github.authorization) {
      expect(authorization, url).toBe(url.startsWith("https://api.github.com/") ? "Bearer secret" : undefined);
    }
  });

  it("refuses a commit without a surface file", async () => {
    const files = surfaceFilesFor();
    delete files["security/surface.txt"];
    const github = fakeGithub({ "1.0.0": { commit: COMMIT, files } }, "v1.0.0");
    const client = createGithubClient({ fetchImpl: github.fetch, repo: TEST_REPO });
    await expect(client.filesAt(COMMIT)).rejects.toThrow(/surface\.txt/);
  });

  it("refuses a surface.txt over the size cap", async () => {
    const files = surfaceFilesFor();
    files["security/surface.txt"] = `${files["security/surface.txt"]}# ${"x".repeat(1_000_001)}\n`;
    const github = fakeGithub({ "1.0.0": { commit: COMMIT, files } }, "v1.0.0");
    const client = createGithubClient({ fetchImpl: github.fetch, repo: TEST_REPO });

    await expect(client.filesAt(COMMIT)).rejects.toThrow(/surface\.txt is larger/);
    expect(github.calls.some((url) => url.includes("raw.githubusercontent.com"))).toBe(false);
  });

  it("leaves out a file over the size cap", async () => {
    const files = surfaceFilesFor();
    files["lib/c.ts"] = `${files["lib/c.ts"]}\n// ${"x".repeat(1_000_001)}\n`;
    const github = fakeGithub({ "1.0.0": { commit: COMMIT, files } }, "v1.0.0");
    const loaded = await createGithubClient({ fetchImpl: github.fetch, repo: TEST_REPO }).filesAt(COMMIT);

    expect(loaded.files.has("lib/c.ts")).toBe(false);
    expect(loaded.functions.some((fn) => fn.file === "lib/c.ts")).toBe(false);
  });
});
