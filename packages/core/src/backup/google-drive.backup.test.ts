import { describe, expect, it, vi } from "vitest";
import { userErrorMessage } from "../models/user-errors";
import { createGoogleDriveFile, type GoogleAuth } from "./google-drive";

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

/** The second part of a `multipart/related` body: what follows its blank line, up to the closing boundary. */
function filePart(body: Uint8Array): Uint8Array {
  const text = new TextDecoder("latin1").decode(body);
  const start = text.indexOf("\r\n\r\n", text.indexOf("\r\n\r\n") + 4) + 4;
  return body.slice(start, text.lastIndexOf("\r\n--"));
}

/** A Drive app folder: the file API's four calls over one in-memory file list. */
function drive() {
  const files = new Map<string, { bytes: Uint8Array; modifiedTime: string }>();
  const calls: Call[] = [];
  let nextId = 1;
  const accepted = new Set(["token-1"]);

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = init.headers as Record<string, string>;
    const body = init.body ? new Uint8Array(init.body as Uint8Array) : null;
    const method = init.method ?? "GET";
    calls.push({ url, method, headers, body });
    if (!accepted.has(headers.authorization!.replace("Bearer ", ""))) return new Response("", { status: 401 });

    const id = decodeURIComponent(url.pathname.split("/files/")[1] ?? "");
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const listed = [...files].map(([fileId, file]) => ({ id: fileId, modifiedTime: file.modifiedTime, size: String(file.bytes.length) }));
      return Response.json({ files: listed.reverse() });
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      files.set(`file-${nextId++}`, { bytes: filePart(body!), modifiedTime: "2026-01-01T00:00:00.000Z" });
      return Response.json({ id: "created" });
    }
    if (!files.has(id)) return new Response("", { status: 404 });
    if (method === "PATCH") {
      files.set(id, { bytes: body!, modifiedTime: "2026-01-02T00:00:00.000Z" });
      return Response.json({ id });
    }
    if (method === "DELETE") {
      files.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response(files.get(id)!.bytes.slice());
  });
  return { files, calls, accepted, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function authWith(tokens: Array<string | null>): GoogleAuth & { forgotten: string[] } {
  const forgotten: string[] = [];
  let current = 0;
  return {
    forgotten,
    token: async () => tokens[Math.min(current, tokens.length - 1)]!,
    forget: async (token) => {
      forgotten.push(token);
      current += 1;
    },
    revoke: vi.fn(async () => {}),
  };
}

const BYTES = new Uint8Array([1, 2, 3, 250, 251, 252]);

describe("createGoogleDriveFile", () => {
  it("reads nothing from an empty app folder", async () => {
    const { fetchImpl } = drive();
    expect(await createGoogleDriveFile(authWith(["token-1"]), fetchImpl).read()).toBeNull();
  });

  it("creates the file in the app folder, then reads the same bytes back", async () => {
    const { fetchImpl, calls, files } = drive();
    const file = createGoogleDriveFile(authWith(["token-1"]), fetchImpl);

    await file.write(BYTES);

    const upload = calls.find((call) => call.method === "POST")!;
    const sent = new TextDecoder("latin1").decode(upload.body!);
    expect(sent).toContain('{"name":"vault.bin","parents":["appDataFolder"]}');
    expect(upload.headers["content-type"]).toMatch(/^multipart\/related; boundary=/);
    expect(files.size).toBe(1);
    expect(await file.read()).toEqual({ bytes: BYTES, updatedAt: Date.parse("2026-01-01T00:00:00.000Z") });
  });

  it("only ever looks inside the app folder", async () => {
    const { fetchImpl, calls } = drive();
    await createGoogleDriveFile(authWith(["token-1"]), fetchImpl).read();
    expect(calls[0]!.url.searchParams.get("spaces")).toBe("appDataFolder");
  });

  it("replaces the file's contents on a later write", async () => {
    const { fetchImpl, files } = drive();
    const file = createGoogleDriveFile(authWith(["token-1"]), fetchImpl);
    await file.write(BYTES);
    await file.write(new Uint8Array([9]));
    expect(files.size).toBe(1);
    expect((await file.read())!.bytes).toEqual(new Uint8Array([9]));
  });

  it("removes every copy, and is done when there is none", async () => {
    const { fetchImpl, files } = drive();
    const file = createGoogleDriveFile(authWith(["token-1"]), fetchImpl);
    await file.remove();
    files.set("a", { bytes: BYTES, modifiedTime: "2026-01-01T00:00:00.000Z" });
    files.set("b", { bytes: BYTES, modifiedTime: "2026-01-01T00:00:00.000Z" });
    await file.remove();
    expect(files.size).toBe(0);
  });

  it("doesn't download a file too large to be a backup", async () => {
    const { fetchImpl, files, calls } = drive();
    files.set("big", { bytes: new Uint8Array(8 * 1024 * 1024 + 1), modifiedTime: "2026-01-01T00:00:00.000Z" });
    expect((await createGoogleDriveFile(authWith(["token-1"]), fetchImpl).read())!.bytes).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("replaces a refused token once, with no UI", async () => {
    const { fetchImpl } = drive();
    const auth = authWith(["expired", "token-1"]);
    expect(await createGoogleDriveFile(auth, fetchImpl).read()).toBeNull();
    expect(auth.forgotten).toEqual(["expired"]);
  });

  it("asks for a sign-in when there is no token, or Google refuses the fresh one too", async () => {
    const { fetchImpl } = drive();
    const needed = userErrorMessage("backupSignInNeeded");
    await expect(createGoogleDriveFile(authWith([null]), fetchImpl).read()).rejects.toThrow(needed);
    await expect(createGoogleDriveFile(authWith(["expired", "expired-too"]), fetchImpl).read()).rejects.toThrow(needed);
    await expect(createGoogleDriveFile(authWith(["expired", null]), fetchImpl).read()).rejects.toThrow(needed);
  });

  it("reports the account as unreachable on a network or server failure", async () => {
    const unreachable = userErrorMessage("backupUnreachable");
    const offline = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    await expect(createGoogleDriveFile(authWith(["token-1"]), offline).read()).rejects.toThrow(unreachable);
    const failing = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(createGoogleDriveFile(authWith(["token-1"]), failing).write(BYTES)).rejects.toThrow(unreachable);
  });

  it("signs in through the shell's auth and revokes through it", async () => {
    const { fetchImpl } = drive();
    const auth = authWith([null]);
    const file = createGoogleDriveFile(auth, fetchImpl);
    expect(await file.signIn(false)).toBe(false);
    await file.revoke();
    expect(auth.revoke).toHaveBeenCalledOnce();
  });
});
