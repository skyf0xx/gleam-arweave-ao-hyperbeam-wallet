// @vitest-environment node
import * as Comlink from "comlink";
import { describe, expect, it } from "vitest";
import type { FileDownloadResult } from "@gleam/core";
import { SAVER_REQUEST, type FileSaver } from "./download-channel";
import { createWorkerDownloads } from "./downloads";

/** A worker scope that hands the posted port to `onPort`, as the page would receive it. */
function scopeWith(saver: FileSaver) {
  const messages: { type: unknown }[] = [];
  return {
    messages,
    scope: {
      postMessage(message: unknown, transfer: Transferable[]) {
        const { type, port } = message as { type: unknown; port: MessagePort };
        messages.push({ type });
        expect(transfer).toEqual([port]);
        Comlink.expose(saver, port);
      },
    },
  };
}

const file = () => ({ filename: "w.json", mimeType: "application/json", bytes: new Uint8Array([1, 2, 3]) });

describe("createWorkerDownloads", () => {
  it("requests the saver, sends a copy and returns the saver's result", async () => {
    let received: Uint8Array | undefined;
    const result: FileDownloadResult = { ok: true, filename: "w.json" };
    const { scope, messages } = scopeWith({
      async save(f) {
        received = f.bytes;
        return result;
      },
    });
    const downloads = createWorkerDownloads(scope);
    expect(messages).toEqual([{ type: SAVER_REQUEST }]);
    const input = file();
    expect(await downloads.saveFile(input)).toEqual(result);
    expect([...received!]).toEqual([1, 2, 3]);
    expect([...input.bytes]).toEqual([1, 2, 3]);
    expect(input.bytes.buffer.byteLength).toBe(3);
  });

  it("maps a thrown call to failed", async () => {
    const { scope } = scopeWith({
      async save() {
        throw new Error("bridge gone");
      },
    });
    expect(await createWorkerDownloads(scope).saveFile(file())).toEqual({ ok: false, reason: "failed" });
  });

  it("is always allowed", async () => {
    const downloads = createWorkerDownloads(scopeWith({ save: async () => ({ ok: false, reason: "failed" }) }).scope);
    expect(await downloads.isAllowed()).toBe(true);
    expect(await downloads.ensureAllowed()).toBe(true);
  });
});
