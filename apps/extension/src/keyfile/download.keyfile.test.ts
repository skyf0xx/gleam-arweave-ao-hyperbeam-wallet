import { describe, expect, it, vi } from "vitest";
import type { RuntimePort } from "@gleam/core";
import { downloadKeyfile, keyfileDownloadError } from "./download";

vi.mock("wxt/browser", () => ({ browser: {} }));

const REQ = { walletId: "wallet-1", password: "correct horse battery staple" };

function runtimeReplying(reply: Promise<unknown>) {
  const send = vi.fn(() => reply);
  return { runtime: { send, onMessage: vi.fn(() => () => {}) } as unknown as RuntimePort, send };
}

describe("downloadKeyfile", () => {
  it("sends the request before the permission prompt can close the popup", async () => {
    const order: string[] = [];
    const { runtime, send } = runtimeReplying(Promise.resolve({ ok: true, filename: "x.json" }));
    send.mockImplementation(() => {
      order.push("send");
      return Promise.resolve({ ok: true, filename: "x.json" });
    });
    const requestPermission = vi.fn(async () => {
      order.push("permission");
      return true;
    });

    await expect(downloadKeyfile(runtime, REQ, requestPermission)).resolves.toEqual({ ok: true, filename: "x.json" });
    expect(order).toEqual(["send", "permission"]);
    expect(send).toHaveBeenCalledWith({ type: "downloadKeyfile", payload: REQ });
  });

  it("reports a denied permission and tells the background to stop waiting", async () => {
    const { runtime, send } = runtimeReplying(new Promise(() => {}));
    send.mockImplementation(((message: { type: string }) =>
      message.type === "cancelKeyfileDownload" ? Promise.resolve(undefined) : new Promise(() => {})) as never);

    await expect(downloadKeyfile(runtime, REQ, async () => false)).resolves.toEqual({ ok: false, reason: "permission" });
    expect(send).toHaveBeenLastCalledWith({ type: "cancelKeyfileDownload", payload: { walletId: "wallet-1" } });
  });

  it("shows a wrong password while the permission prompt is still open", async () => {
    const { runtime } = runtimeReplying(Promise.reject(new Error("That password didn't work.")));
    await expect(downloadKeyfile(runtime, REQ, () => new Promise(() => {}))).rejects.toThrow("didn't work");
  });

  it("passes a background rejection through, such as a wrong password", async () => {
    const { runtime } = runtimeReplying(Promise.reject(new Error("That password didn't work.")));
    await expect(downloadKeyfile(runtime, REQ, async () => true)).rejects.toThrow("didn't work");
  });
});

describe("keyfileDownloadError", () => {
  it("names a denied permission and that nothing was saved", () => {
    expect(keyfileDownloadError({ ok: false, reason: "permission" })).toMatch(/permission.*Nothing was downloaded/);
  });

  it("is null for a saved file", () => {
    expect(keyfileDownloadError({ ok: true, filename: "x.json" })).toBeNull();
  });
});
