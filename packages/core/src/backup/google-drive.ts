import { userErrorMessage } from "../models/user-errors";
import type { CloudFilePort } from "../ports/cloud-file";
import { MAX_BACKUP_FILE_BYTES } from "./file";

type Bytes = Uint8Array<ArrayBuffer>;

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
/**
 * Drive's per-app folder: hidden from the user's Drive, readable only by
 * this OAuth client, and all the `drive.appdata` scope reaches.
 */
const APP_FOLDER = "appDataFolder";
const FILE_NAME = "vault.bin";

/** The only scope Gleam asks Google for. */
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

/** Where a shell gets Google access tokens for `GOOGLE_DRIVE_SCOPE`. */
export interface GoogleAuth {
  /**
   * An access token, or null when there is none to be had: with
   * `interactive` false it never shows UI; with it true, null means the
   * person closed the sign-in.
   */
  token(interactive: boolean): Promise<string | null>;
  /** Drops a token Google refused, so the next `token` call fetches a new one. */
  forget(token: string): Promise<void>;
  /** Ends this install's access to the account. */
  revoke(): Promise<void>;
}

interface DriveFile {
  id: string;
  modifiedTime: string;
  size?: string;
}

function isDriveFile(value: unknown): value is DriveFile {
  if (value === null || typeof value !== "object") return false;
  const { id, modifiedTime, size } = value as Record<string, unknown>;
  return typeof id === "string" && id.length > 0 && typeof modifiedTime === "string" && (size === undefined || typeof size === "string");
}

function unreachable(): Error {
  return new Error(userErrorMessage("backupUnreachable"));
}

/**
 * `CloudFilePort` over one file in the Google Drive app folder, through
 * Drive's REST API. Google sees the file's bytes and nothing else: no
 * request carries anything about the vault.
 */
export function createGoogleDriveFile(auth: GoogleAuth, fetchImpl: typeof fetch = fetch): CloudFilePort {
  async function send(url: string, init: RequestInit, token: string): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
    } catch {
      throw unreachable();
    }
  }

  /** One Drive call. A refused token is replaced once, with no UI, before giving up. */
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await auth.token(false);
    if (token === null) throw new Error(userErrorMessage("backupSignInNeeded"));
    let response = await send(url, init, token);
    if (response.status === 401) {
      await auth.forget(token);
      const fresh = await auth.token(false);
      if (fresh === null) throw new Error(userErrorMessage("backupSignInNeeded"));
      response = await send(url, init, fresh);
    }
    if (response.status === 401) throw new Error(userErrorMessage("backupSignInNeeded"));
    return response;
  }

  /** Every backup file in the app folder, newest first. Two can exist when two devices set up at once. */
  async function list(): Promise<DriveFile[]> {
    const query = new URLSearchParams({
      spaces: APP_FOLDER,
      q: `name = '${FILE_NAME}' and trashed = false`,
      fields: "files(id,modifiedTime,size)",
      orderBy: "modifiedTime desc",
      pageSize: "10",
    });
    const response = await call(`${FILES_URL}?${query}`);
    if (!response.ok) throw unreachable();
    const { files } = (await response.json().catch(() => ({}))) as { files?: unknown };
    return Array.isArray(files) ? files.filter(isDriveFile) : [];
  }

  function fileUrl(id: string, query = ""): string {
    return `${FILES_URL}/${encodeURIComponent(id)}${query}`;
  }

  return {
    provider: "google",

    async signIn(interactive) {
      return (await auth.token(interactive)) !== null;
    },

    async read() {
      const [file] = await list();
      if (!file) return null;
      const updatedAt = Date.parse(file.modifiedTime);
      // Too large to be a backup: hand back bytes the caller reads as unreadable, without downloading them.
      if (Number(file.size ?? 0) > MAX_BACKUP_FILE_BYTES) return { bytes: new Uint8Array(), updatedAt };
      const response = await call(fileUrl(file.id, "?alt=media"));
      if (response.status === 404) return null;
      if (!response.ok) throw unreachable();
      return { bytes: new Uint8Array(await response.arrayBuffer()), updatedAt };
    },

    async write(bytes) {
      const [file] = await list();
      const response = file
        ? await call(`${UPLOAD_URL}/${encodeURIComponent(file.id)}?uploadType=media`, {
            method: "PATCH",
            headers: { "content-type": "application/octet-stream" },
            body: bytes,
          })
        : await call(`${UPLOAD_URL}?uploadType=multipart`, { method: "POST", ...multipart(bytes) });
      if (!response.ok) throw unreachable();
    },

    async remove() {
      for (const file of await list()) {
        const response = await call(fileUrl(file.id), { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw unreachable();
      }
    },

    revoke: () => auth.revoke(),
  };
}

/** A `multipart/related` upload: the file's name and folder, then its bytes. */
function multipart(bytes: Bytes): { headers: Record<string, string>; body: Bytes } {
  const boundary = `gleam-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name: FILE_NAME, parents: [APP_FOLDER] })}\r\n` +
      `--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { headers: { "content-type": `multipart/related; boundary=${boundary}` }, body };
}
