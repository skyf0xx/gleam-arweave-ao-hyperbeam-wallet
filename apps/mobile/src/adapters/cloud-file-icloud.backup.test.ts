import { describe, expect, it, vi } from "vitest";
import { CLOUD_ERROR, type ICloudFilePlugin } from "@gleam/cloud-backup";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { createICloudFile } from "./cloud-file-icloud";

/** A CloudKit private database with room for the one record. */
function stubPlugin(overrides: Partial<ICloudFilePlugin> = {}): ICloudFilePlugin {
  let record: { data: string; modifiedAt: number } | null = null;
  return {
    available: vi.fn(async () => ({ available: true })),
    read: vi.fn(async () => record ?? {}),
    write: vi.fn(async ({ data }) => {
      record = { data, modifiedAt: 1_700_000_000_000 };
    }),
    remove: vi.fn(async () => {
      record = null;
    }),
    ...overrides,
  };
}

const nativeError = (code: string) => Object.assign(new Error("native"), { code });

describe("createICloudFile", () => {
  it("round-trips bytes larger than one base64 chunk", async () => {
    const file = createICloudFile(stubPlugin());
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31) % 256);
    await file.write(bytes);
    const read = await file.read();
    expect(read?.updatedAt).toBe(1_700_000_000_000);
    expect(read?.bytes).toEqual(bytes);
  });

  it("reads no record as no file, and remove empties it", async () => {
    const file = createICloudFile(stubPlugin());
    expect(await file.read()).toBeNull();
    await file.write(new Uint8Array([1]));
    await file.remove();
    expect(await file.read()).toBeNull();
  });

  it("hands back bytes that aren't base64 as empty, for the runtime to call unreadable", async () => {
    const file = createICloudFile(stubPlugin({ read: async () => ({ data: "%%%", modifiedAt: 1 }) }));
    expect((await file.read())?.bytes).toEqual(new Uint8Array());
  });

  it("signs in exactly when an account is available, never throwing", async () => {
    expect(await createICloudFile(stubPlugin()).signIn(true)).toBe(true);
    expect(await createICloudFile(stubPlugin({ available: async () => ({ available: false }) })).signIn(false)).toBe(false);
    expect(
      await createICloudFile(
        stubPlugin({
          available: async () => {
            throw nativeError(CLOUD_ERROR.unreachable);
          },
        }),
      ).signIn(true),
    ).toBe(false);
  });

  it("maps a missing account to sign-in and anything else to unreachable", async () => {
    const signedOut = createICloudFile(
      stubPlugin({
        write: async () => {
          throw nativeError(CLOUD_ERROR.notSignedIn);
        },
      }),
    );
    await expect(signedOut.write(new Uint8Array([1]))).rejects.toThrow(userErrorMessage("backupSignInNeeded"));
    const offline = createICloudFile(
      stubPlugin({
        read: async () => {
          throw nativeError(CLOUD_ERROR.unreachable);
        },
      }),
    );
    await expect(offline.read()).rejects.toThrow(userErrorMessage("backupUnreachable"));
  });

  it("is iCloud, and revoke has nothing to end", async () => {
    const plugin = stubPlugin();
    const file = createICloudFile(plugin);
    expect(file.provider).toBe("icloud");
    await file.revoke();
    expect(plugin.remove).not.toHaveBeenCalled();
  });
});
