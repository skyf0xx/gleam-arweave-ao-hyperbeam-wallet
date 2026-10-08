import { chromium, expect, test, type BrowserContext, type Worker } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The Gleam Points invite handoff, end to end: invite.html keeps the code,
 * then welcome.html (which the extension opens on install) sends it to
 * the built extension over externally_connectable. The site's files are
 * served under its real origin, since externally_connectable matches only
 * that origin. The unpacked extension's id differs from the store id, so
 * pages.js is served with the test id swapped in.
 */
const extensionPath = fileURLToPath(new URL("../apps/extension/.output/chrome-mv3", import.meta.url));
const siteDir = fileURLToPath(new URL("../apps/site/", import.meta.url));
const SITE = "https://gleam-permaweb.vercel.app";
const STORE_EXTENSION_ID = "einabcphdmlicabnjllaaallnebfkmki";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

let context: BrowserContext;
let worker: Worker;

test.beforeAll(async () => {
  if (!existsSync(extensionPath)) {
    throw new Error(`No build at ${extensionPath}; run \`pnpm wxt:build\` first.`);
  }
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;

  await context.route("https://cloud.umami.is/**", (route) => route.abort());
  await context.route(`${SITE}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html";
    const file = `${siteDir}${path}`;
    if (!existsSync(file)) return route.fulfill({ status: 404 });
    let body: string | Buffer = readFileSync(file);
    if (path === "pages.js") body = body.toString().replace(STORE_EXTENSION_ID, extensionId);
    await route.fulfill({ body, contentType: CONTENT_TYPES[extname(path)] ?? "application/octet-stream" });
  });
});

test.afterAll(async () => {
  await context?.close();
});

function pendingInviteCode(): Promise<unknown> {
  return worker.evaluate(async () => (await chrome.storage.local.get("points:pendingInviteCode"))["points:pendingInviteCode"]);
}

test("an invite link's code reaches the extension via the welcome page", async () => {
  const page = await context.newPage();

  await page.goto(`${SITE}/invite.html?c=friend42`);
  await expect(page.locator("[data-invite-code-value]")).toHaveText("FRIEND42");
  expect(await pendingInviteCode()).toBeUndefined();

  await page.goto(`${SITE}/welcome.html?v=test`);
  await expect.poll(pendingInviteCode).toBe("FRIEND42");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("gleam:inviteCode")))
    .toBeNull();
});

test("a page on another origin can't message the extension", async () => {
  const page = await context.newPage();
  await page.route("https://example.com/**", (route) => route.fulfill({ body: "<html></html>", contentType: "text/html" }));
  await page.goto("https://example.com/");

  expect(await page.evaluate(() => typeof (window as { chrome?: { runtime?: unknown } }).chrome?.runtime)).toBe("undefined");
});
