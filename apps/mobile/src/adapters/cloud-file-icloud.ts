import { CLOUD_ERROR, ICloudFile, type ICloudFilePlugin } from "@gleam/cloud-backup";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import type { CloudFilePort } from "@gleam/core/src/ports/cloud-file.ts";

type Bytes = Uint8Array<ArrayBuffer>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Empty when `text` isn't base64, which the runtime then reads as an unreadable backup. */
function fromBase64(text: string): Bytes {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

function failure(error: unknown): Error {
  const code = (error as { code?: unknown } | null)?.code;
  return new Error(userErrorMessage(code === CLOUD_ERROR.notSignedIn ? "backupSignInNeeded" : "backupUnreachable"));
}

/**
 * `CloudFilePort` over one record in the private CloudKit database. There
 * is no sign-in UI: the phone's iCloud account is the account, and Apple
 * holds the grant, so `revoke` has nothing to end.
 */
export function createICloudFile(plugin: ICloudFilePlugin = ICloudFile): CloudFilePort {
  async function call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw failure(error);
    }
  }

  return {
    provider: "icloud",

    async signIn() {
      try {
        return (await plugin.available()).available === true;
      } catch {
        return false;
      }
    },

    async read() {
      const { data, modifiedAt } = await call(() => plugin.read());
      if (typeof data !== "string") return null;
      return { bytes: fromBase64(data), updatedAt: typeof modifiedAt === "number" && Number.isFinite(modifiedAt) ? modifiedAt : 0 };
    },

    async write(bytes) {
      await call(() => plugin.write({ data: toBase64(bytes) }));
    },

    async remove() {
      await call(() => plugin.remove());
    },

    revoke: async () => {},
  };
}
