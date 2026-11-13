import { describe, expect, it, vi } from "vitest";
import type { GoogleDriveAuthPlugin } from "@gleam/cloud-backup";
import { createGoogleDriveFile } from "@gleam/core/src/backup/google-drive.ts";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { createAndroidGoogleAuth } from "./cloud-file-google";

function stubPlugin(answers: Array<{ accessToken?: string } | Error>): GoogleDriveAuthPlugin & { authorize: ReturnType<typeof vi.fn>; clearToken: ReturnType<typeof vi.fn> } {
  return {
    authorize: vi.fn(async () => {
      const next = answers.shift() ?? {};
      if (next instanceof Error) throw next;
      return next;
    }),
    clearToken: vi.fn(async () => {}),
  };
}

const list = (files: unknown[]) => new Response(JSON.stringify({ files }), { status: 200 });

describe("createAndroidGoogleAuth", () => {
  it("hands back Play services' token and asks without UI when not interactive", async () => {
    const plugin = stubPlugin([{ accessToken: "t1" }]);
    expect(await createAndroidGoogleAuth(plugin).token(false)).toBe("t1");
    expect(plugin.authorize).toHaveBeenCalledWith({ interactive: false });
  });

  it("reads no token as needing the person", async () => {
    const plugin = stubPlugin([{}]);
    const drive = createGoogleDriveFile(createAndroidGoogleAuth(plugin), vi.fn());
    expect(await drive.signIn(false)).toBe(false);
  });

  it("opens one consent screen for callers arriving together", async () => {
    const plugin = stubPlugin([{ accessToken: "t1" }]);
    const auth = createAndroidGoogleAuth(plugin);
    expect(await Promise.all([auth.token(true), auth.token(true)])).toEqual(["t1", "t1"]);
    expect(plugin.authorize).toHaveBeenCalledTimes(1);
  });

  it("reports a plugin failure as unreachable, not as signed out", async () => {
    const plugin = stubPlugin([Object.assign(new Error("Couldn't reach Google"), { code: "UNREACHABLE" })]);
    await expect(createAndroidGoogleAuth(plugin).token(false)).rejects.toThrow(userErrorMessage("backupUnreachable"));
  });

  it("clears a token Drive refused and retries with a fresh one", async () => {
    const plugin = stubPlugin([{ accessToken: "stale" }, { accessToken: "fresh" }]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.headers as Record<string, string>).authorization === "Bearer stale" ? new Response(null, { status: 401 }) : list([]),
    );
    const drive = createGoogleDriveFile(createAndroidGoogleAuth(plugin), fetchImpl as unknown as typeof fetch);
    expect(await drive.read()).toBeNull();
    expect(plugin.clearToken).toHaveBeenCalledWith({ token: "stale" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("revokes the current token with Google and drops it from the cache", async () => {
    const plugin = stubPlugin([{ accessToken: "t1" }]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await createAndroidGoogleAuth(plugin, fetchImpl as unknown as typeof fetch).revoke();
    expect(fetchImpl).toHaveBeenCalledWith("https://oauth2.googleapis.com/revoke", expect.objectContaining({ method: "POST" }));
    const body = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("token")).toBe("t1");
    expect(plugin.clearToken).toHaveBeenCalledWith({ token: "t1" });
  });

  it("revokes nothing when there is no grant", async () => {
    const fetchImpl = vi.fn();
    await createAndroidGoogleAuth(stubPlugin([{}]), fetchImpl).revoke();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
