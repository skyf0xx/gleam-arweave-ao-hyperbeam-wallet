import { describe, expect, it, vi } from "vitest";
import { Directory } from "@capacitor/filesystem";
import { createWorkerDownloads } from "./downloads";
import { createFileSaver, serveFileSaver, sweepExports, type SaverPlugins } from "./file-saver";

vi.mock("@capacitor/filesystem", () => ({ Directory: { Cache: "CACHE" }, Filesystem: {} }));
vi.mock("@capacitor/share", () => ({ Share: {} }));

function setup(share: SaverPlugins["share"] = async () => ({})) {
  const calls: string[] = [];
  const plugins: SaverPlugins = {
    writeFile: vi.fn(async ({ path }) => {
      calls.push("write");
      return { uri: `file:///cache/${path}` };
    }),
    share: vi.fn(async (options) => {
      calls.push("share");
      return share(options);
    }),
    readdir: vi.fn(async () => ({ files: [] })),
    rmdir: vi.fn(async () => {
      calls.push("delete");
    }),
  };
  return { plugins, calls };
}

const file = () => ({ filename: "wallet.json", mimeType: "application/json", bytes: new TextEncoder().encode('{"kty":"RSA"}') });

describe("createFileSaver", () => {
  it("writes to the cache, shares, then deletes, keeping the chosen name", async () => {
    const { plugins, calls } = setup();
    const result = await createFileSaver(plugins).save(file());
    expect(result).toEqual({ ok: true, filename: "wallet.json" });
    expect(calls).toEqual(["write", "share", "delete"]);
    const write = vi.mocked(plugins.writeFile).mock.calls[0]![0];
    expect(write.directory).toBe(Directory.Cache);
    expect(write.path).toMatch(/^gleam-export-[\w-]+\/wallet\.json$/);
    expect(atob(write.data)).toBe('{"kty":"RSA"}');
    expect(vi.mocked(plugins.share).mock.calls[0]![0].files).toEqual([`file:///cache/${write.path}`]);
    const rm = vi.mocked(plugins.rmdir).mock.calls[0]![0];
    expect(rm).toMatchObject({ path: write.path.split("/")[0], recursive: true });
  });

  it("deletes the file and reports cancelled when the sheet is dismissed", async () => {
    const { plugins, calls } = setup(async () => {
      throw new Error("Share canceled");
    });
    expect(await createFileSaver(plugins).save(file())).toEqual({ ok: false, reason: "cancelled" });
    expect(calls).toEqual(["write", "share", "delete"]);
  });

  it("deletes the file and reports failed when sharing breaks", async () => {
    const { plugins, calls } = setup(async () => {
      throw new Error("Error sharing item");
    });
    expect(await createFileSaver(plugins).save(file())).toEqual({ ok: false, reason: "failed" });
    expect(calls).toEqual(["write", "share", "delete"]);
  });

  it("reports failed, without sharing, when the write fails, and still cleans up", async () => {
    const { plugins, calls } = setup();
    vi.mocked(plugins.writeFile).mockRejectedValueOnce(new Error("disk full"));
    expect(await createFileSaver(plugins).save(file())).toEqual({ ok: false, reason: "failed" });
    expect(calls).toEqual(["delete"]);
  });

  it("zeroes its copy of the bytes and keeps path separators out of the name", async () => {
    const { plugins } = setup();
    const input = { ...file(), filename: "../a/b.json" };
    await createFileSaver(plugins).save(input);
    expect(input.bytes.every((b) => b === 0)).toBe(true);
    expect(vi.mocked(plugins.writeFile).mock.calls[0]![0].path).toMatch(/\/\.\._a_b\.json$/);
  });

  it("still succeeds when deleting the temp file fails", async () => {
    const { plugins } = setup();
    vi.mocked(plugins.rmdir).mockRejectedValueOnce(new Error("gone"));
    expect(await createFileSaver(plugins).save(file())).toEqual({ ok: true, filename: "wallet.json" });
  });
});

describe("sweepExports", () => {
  it("removes only gleam-export folders", async () => {
    const { plugins } = setup();
    vi.mocked(plugins.readdir).mockResolvedValueOnce({
      files: [{ name: "gleam-export-a" }, { name: "image_cache" }, { name: "gleam-export-b" }],
    });
    await sweepExports(plugins);
    expect(vi.mocked(plugins.rmdir).mock.calls.map(([o]) => o.path)).toEqual(["gleam-export-a", "gleam-export-b"]);
  });

  it("swallows a readdir failure", async () => {
    const { plugins } = setup();
    vi.mocked(plugins.readdir).mockRejectedValueOnce(new Error("no cache"));
    await expect(sweepExports(plugins)).resolves.toBeUndefined();
    expect(plugins.rmdir).not.toHaveBeenCalled();
  });

  it("leaves a folder a save in this session is using", async () => {
    const { plugins } = setup();
    let release!: () => void;
    vi.mocked(plugins.share).mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({}))));
    const saving = createFileSaver(plugins).save(file());
    await vi.waitFor(() => expect(plugins.share).toHaveBeenCalled());
    const folder = vi.mocked(plugins.writeFile).mock.calls[0]![0].path.split("/")[0]!;
    vi.mocked(plugins.readdir).mockResolvedValueOnce({ files: [{ name: folder }, { name: "gleam-export-old" }] });
    await sweepExports(plugins);
    expect(vi.mocked(plugins.rmdir).mock.calls.map(([o]) => o.path)).toEqual(["gleam-export-old"]);
    release();
    await saving;
  });
});

describe("serveFileSaver", () => {
  it("passes the worker's transferred save call through its guard", async () => {
    const { plugins, calls } = setup();
    const worker = new EventTarget();
    serveFileSaver(worker as Worker, createFileSaver(plugins));
    const ports: MessagePort[] = [];
    const downloads = createWorkerDownloads({
      postMessage: (message, transfer) => {
        ports.push(...(transfer as MessagePort[]));
        worker.dispatchEvent(new MessageEvent("message", { data: message }));
      },
    });
    await expect(downloads.saveFile(file())).resolves.toEqual({ ok: true, filename: "wallet.json" });
    expect(calls).toEqual(["write", "share", "delete"]);
    ports.forEach((port) => port.close());
  });
});
