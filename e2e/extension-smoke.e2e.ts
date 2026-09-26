import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads the production bundle and fails on any runtime error. Vitest runs
 * source through Vite's dev transform, so bundler-only breakage (e.g. a
 * CommonJS default import resolving to `{ default }` under Rolldown) only
 * shows up here.
 */
const extensionPath = fileURLToPath(
  new URL("../apps/extension/.output/chrome-mv3", import.meta.url),
);

// Pages that render without any wallet or pending request.
const PAGES = ["popup.html", "approval.html"];

let context: BrowserContext;
let extensionId: string;
const errors: string[] = [];

test.beforeAll(async () => {
  if (!existsSync(extensionPath)) {
    throw new Error(`No build at ${extensionPath}; run \`pnpm wxt:build\` first.`);
  }
  // Extensions only load in a persistent context; the `chromium` channel
  // is what lets them run headless.
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  context.on("weberror", (e) => errors.push(`[page] ${e.error().stack ?? e.error()}`));
  context.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
  });

  // A top-level throw in background.js stops the worker registering, so
  // this wait is also the check that the worker's module evaluated.
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  worker.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[service worker] ${msg.text()}`);
  });
  extensionId = new URL(worker.url()).host;
  expect(await worker.evaluate(() => self.location.protocol)).toBe("chrome-extension:");
});

test.afterAll(async () => {
  await context?.close();
});

for (const path of PAGES) {
  test(`${path} loads without runtime errors`, async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    await page.waitForLoadState("networkidle");
    // Checked before the render so a crash reports its error, not a
    // blank page. Includes anything the worker logged since the last test.
    expect(errors.splice(0), "runtime errors").toEqual([]);
    await expect(page.locator("body")).not.toBeEmpty();
    await page.close();
  });
}
