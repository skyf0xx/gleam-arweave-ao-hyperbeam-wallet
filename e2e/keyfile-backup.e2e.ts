import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The keyfile backup is written by the background service worker through
 * `chrome.downloads`, from a `data:` URL. Only the real browser shows that
 * a service worker can start that download and that the file on disk is
 * the plain keyfile.
 *
 * `downloads` is an optional permission, and Chrome's prompt for it can't
 * be answered from Playwright. The granted case therefore loads a copy of
 * the build whose manifest grants it up front; the stock build covers a
 * permission that never arrives.
 */
const extensionPath = fileURLToPath(new URL("../apps/extension/.output/chrome-mv3", import.meta.url));
const PASSWORD = "correct horse battery staple 42";
const JWK_FIELDS = ["kty", "n", "e", "d", "p", "q", "dp", "dq", "qi"];

interface Harness {
  context: BrowserContext;
  extensionId: string;
  downloadsPath: string;
  cleanup: () => Promise<void>;
}

async function launch(grantDownloads: boolean): Promise<Harness> {
  if (!existsSync(extensionPath)) {
    throw new Error(`No build at ${extensionPath}; run \`pnpm wxt:build\` first.`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "gleam-keyfile-"));
  const downloadsPath = join(scratch, "downloads");
  let path = extensionPath;
  if (grantDownloads) {
    path = join(scratch, "extension");
    cpSync(extensionPath, path, { recursive: true });
    const manifestPath = join(path, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { permissions: string[] };
    manifest.permissions.push("downloads");
    writeFileSync(manifestPath, JSON.stringify(manifest));
  }
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    acceptDownloads: true,
    downloadsPath,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  await context.route("https://gleamwallet.app/**", (route) => route.fulfill({ body: "" }));
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  return {
    context,
    extensionId: new URL(worker.url()).host,
    downloadsPath,
    cleanup: async () => {
      await context.close();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

/** Calls a background method the way `@webext-core/messaging` does. */
function call(page: Page, type: string, data?: unknown): Promise<unknown> {
  return page.evaluate(
    ([type, data]) =>
      new Promise((resolve, reject) =>
        chrome.runtime.sendMessage({ id: Date.now(), type, data, timestamp: Date.now() }, (reply) =>
          reply?.err ? reject(new Error(reply.err.message)) : resolve(reply?.res),
        ),
      ),
    [type, data] as const,
  );
}

function savedKeyfiles(downloadsPath: string): Array<Record<string, string>> {
  if (!existsSync(downloadsPath)) return [];
  return readdirSync(downloadsPath).flatMap((name) => {
    try {
      const parsed = JSON.parse(readFileSync(join(downloadsPath, name), "utf8")) as Record<string, string>;
      return parsed.kty === "RSA" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

async function createWallet(harness: Harness): Promise<{ page: Page; wallet: { id: string; publicKey: string } }> {
  const page = await harness.context.newPage();
  await page.goto(`chrome-extension://${harness.extensionId}/passkey.html?mode=setup`);
  const wallet = (await call(page, "createWallet", { name: "Rose Quartz", password: PASSWORD })) as {
    id: string;
    publicKey: string;
  };
  return { page, wallet };
}

test("the background saves the keyfile, records the backup, and the reply carries no key", async () => {
  const harness = await launch(true);
  try {
    const { page, wallet } = await createWallet(harness);

    await expect(call(page, "downloadKeyfile", { walletId: wallet.id, password: "wrong password entirely" })).rejects.toThrow();
    expect(savedKeyfiles(harness.downloadsPath)).toEqual([]);

    const result = (await call(page, "downloadKeyfile", { walletId: wallet.id, password: PASSWORD })) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(["filename", "ok"]);
    expect(result.ok).toBe(true);
    expect(typeof result.filename).toBe("string");

    await expect.poll(() => savedKeyfiles(harness.downloadsPath).length).toBe(1);
    const [keyfile] = savedKeyfiles(harness.downloadsPath);
    expect(keyfile!.n).toBe(wallet.publicKey);
    expect(keyfile!.d!.length).toBeGreaterThan(100);
    const reply = JSON.stringify(result);
    for (const field of JWK_FIELDS) {
      expect(reply).not.toContain(`"${field}"`);
      if (field !== "kty" && field !== "e") expect(reply).not.toContain(keyfile![field]!.slice(0, 16));
    }

    const state = (await call(page, "getState")) as { wallets: Array<{ id: string; backupConfirmedAt: number | null }> };
    expect(state.wallets.find((entry) => entry.id === wallet.id)?.backupConfirmedAt).toEqual(expect.any(Number));

    const history = await page.evaluate(() => chrome.downloads.search({}));
    expect(history.filter((item) => item.url.startsWith("data:"))).toEqual([]);
  } finally {
    await harness.cleanup();
  }
});

test("the background erases a keyfile download its own save never cleaned up", async () => {
  const harness = await launch(true);
  try {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.extensionId}/passkey.html?mode=setup`);

    // Stands in for a save whose worker stopped before it could erase the row.
    const id = await page.evaluate(() =>
      chrome.downloads.download({ url: "data:application/json;base64,eyJrdHkiOiJSU0EifQ==", filename: "orphan.json" }),
    );

    await expect.poll(() => page.evaluate((downloadId) => chrome.downloads.search({ id: downloadId }), id)).toEqual([]);
  } finally {
    await harness.cleanup();
  }
});

test("without the downloads permission nothing is saved and the backup stays unrecorded", async () => {
  const harness = await launch(false);
  try {
    const { page, wallet } = await createWallet(harness);

    // The password is checked before the background waits for the grant.
    await expect(call(page, "downloadKeyfile", { walletId: wallet.id, password: "wrong password entirely" })).rejects.toThrow();

    // The background waits for a grant until the popup reports the denial.
    const pending = call(page, "downloadKeyfile", { walletId: wallet.id, password: PASSWORD });
    await page.waitForTimeout(1_000);
    await call(page, "cancelKeyfileDownload", { walletId: wallet.id });
    expect(await pending).toEqual({ ok: false, reason: "permission" });

    expect(savedKeyfiles(harness.downloadsPath)).toEqual([]);
    const state = (await call(page, "getState")) as { wallets: Array<{ id: string; backupConfirmedAt: number | null }> };
    expect(state.wallets.find((entry) => entry.id === wallet.id)?.backupConfirmedAt).toBeNull();
  } finally {
    await harness.cleanup();
  }
});
