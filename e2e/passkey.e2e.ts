import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Passkey setup and unlock against the production bundle, with Chrome's
 * virtual authenticator standing in for Touch ID or a security key. It
 * supports PRF, so this covers the real WebAuthn calls, the extension's
 * RP id and the background's unwrap.
 */
const extensionPath = fileURLToPath(new URL("../apps/extension/.output/chrome-mv3", import.meta.url));
const PASSWORD = "correct horse battery staple 42";

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
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
});

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

/** WebAuthn refuses a page without focus, which a headless tab can lose. */
async function withAuthenticator(page: Page): Promise<void> {
  await page.bringToFront();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
}

test("sets up a passkey and unlocks Gleam with it", async () => {
  const page = await context.newPage();
  // Added after the first navigation: moving from about:blank into the
  // extension's process would leave the authenticator behind.
  await page.goto(`chrome-extension://${extensionId}/passkey.html?mode=setup`);
  await withAuthenticator(page);
  await call(page, "createWallet", { name: "Wallet 1", password: PASSWORD });

  await page.getByPlaceholder("Enter your Gleam password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create passkey" }).click();
  await expect(page.getByText("Passkey ready")).toBeVisible();
  expect(await call(page, "getPasskeyStatus")).toMatchObject({ enrolled: true });

  await call(page, "lockWallet");
  expect(await call(page, "getState")).toMatchObject({ session: null });

  // The unlock window starts the prompt on its own, then closes itself.
  const closed = page.waitForEvent("close");
  await page.goto(`chrome-extension://${extensionId}/passkey.html?mode=unlock`);
  await closed;

  const check = await context.newPage();
  await check.goto(`chrome-extension://${extensionId}/passkey.html?mode=setup`);
  expect(await call(check, "getState")).toMatchObject({ session: { unlockedWalletIds: [expect.any(String)] } });
  await check.close();
});
