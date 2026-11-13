// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { CLOUD_FILE_REQUEST, serveCloudFile, type CloudFileHost } from "./cloud-file-channel";
import { createWorkerCloudFile } from "./cloud-file";

/** A worker whose scope posts to the page's listeners, as a real one would. */
function connect(host: CloudFileHost) {
  const worker = new EventTarget() as unknown as Worker;
  serveCloudFile(worker, host);
  const posted: unknown[] = [];
  const scope = {
    postMessage(message: unknown, transfer: Transferable[]) {
      posted.push((message as { type: unknown }).type);
      expect(transfer).toEqual([(message as { port: unknown }).port]);
      worker.dispatchEvent(new MessageEvent("message", { data: message }));
    },
  };
  return { worker, scope, posted };
}

function stubHost(overrides: Partial<CloudFileHost> = {}): CloudFileHost {
  return {
    signIn: vi.fn(async () => true),
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("createWorkerCloudFile", () => {
  it("asks the page for the file and carries the provider", () => {
    const { scope, posted } = connect(stubHost());
    expect(createWorkerCloudFile(scope, "icloud").provider).toBe("icloud");
    expect(posted).toEqual([CLOUD_FILE_REQUEST]);
  });

  it("round-trips bytes and leaves the caller's own", async () => {
    let stored: Uint8Array | undefined;
    const { scope } = connect(
      stubHost({
        write: async (bytes) => {
          stored = bytes;
        },
        read: async () => ({ bytes: new Uint8Array(stored!), updatedAt: 42 }),
      }),
    );
    const file = createWorkerCloudFile(scope, "google");
    const input = new Uint8Array([1, 2, 3]);
    await file.write(input);
    expect([...input]).toEqual([1, 2, 3]);
    const read = await file.read();
    expect(read?.updatedAt).toBe(42);
    expect([...read!.bytes]).toEqual([1, 2, 3]);
  });

  it("passes interactive through and accepts only true from signIn", async () => {
    const signIn = vi.fn(async () => "yes" as unknown as boolean);
    const { scope } = connect(stubHost({ signIn }));
    expect(await createWorkerCloudFile(scope, "google").signIn(true)).toBe(false);
    expect(signIn).toHaveBeenCalledWith(true);
  });

  it("refuses a read the page answered with the wrong shape", async () => {
    const { scope } = connect(stubHost({ read: async () => ({ bytes: [1, 2] as unknown as Uint8Array<ArrayBuffer>, updatedAt: 1 }) }));
    await expect(createWorkerCloudFile(scope, "google").read()).rejects.toThrow(userErrorMessage("backupUnreachable"));
  });

  it("carries an error's message back for the runtime to match", async () => {
    const { scope } = connect(
      stubHost({
        remove: async () => {
          throw new Error(userErrorMessage("backupSignInNeeded"));
        },
      }),
    );
    await expect(createWorkerCloudFile(scope, "google").remove()).rejects.toThrow(userErrorMessage("backupSignInNeeded"));
  });

  it("serves only the first request", async () => {
    const host = stubHost();
    const { scope } = connect(host);
    createWorkerCloudFile(scope, "google");
    const second = createWorkerCloudFile(scope, "google");
    const outcome = await Promise.race([second.revoke().then(() => "answered"), new Promise((done) => setTimeout(() => done("ignored"), 50))]);
    expect(outcome).toBe("ignored");
    expect(host.revoke).not.toHaveBeenCalled();
  });
});
