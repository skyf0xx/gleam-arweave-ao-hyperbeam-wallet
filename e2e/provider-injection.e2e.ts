import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The page-world provider is injected on http(s) pages, and its
 * web-accessible URL is dynamic, so a page can't probe the extension's
 * static id to detect Gleam.
 */
const extensionPath = fileURLToPath(new URL("../apps/extension/.output/chrome-mv3", import.meta.url));

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  if (!existsSync(extensionPath)) {
    throw new Error(`No build at ${extensionPath}; run \`pnpm wxt:build\` first.`);
  }
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const [worker] = context.serviceWorkers();
  extensionId = new URL((worker ?? (await context.waitForEvent("serviceworker"))).url()).host;
});

test.afterAll(async () => {
  await context?.close();
});

test("the provider is injected and its static URL is not fetchable by the page", async () => {
  const page = await context.newPage();
  await page.route("https://example.com/**", (route) => route.fulfill({ body: "<html></html>", contentType: "text/html" }));
  await page.goto("https://example.com/");

  await expect.poll(() => page.evaluate(() => typeof (window as { arweaveWallet?: unknown }).arweaveWallet)).toBe("object");

  const probe = await page.evaluate(async (id) => {
    try {
      const res = await fetch(`chrome-extension://${id}/provider.js`);
      return `status ${res.status}`;
    } catch {
      return "failed";
    }
  }, extensionId);
  expect(probe).toBe("failed");
});
