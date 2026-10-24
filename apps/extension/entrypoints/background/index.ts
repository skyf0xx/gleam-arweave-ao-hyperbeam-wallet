import { defineExtensionMessaging } from "@webext-core/messaging";
import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import { WxtStoragePort } from "@/src/adapters/storage";
import { listenForKeyringConnections, sessionKeyStore } from "@/src/adapters/session-key-store";
import { WindowApprovalPresenter } from "@/src/adapters/windows";
import { restrictSessionStorageToTrustedContexts } from "@/src/adapters/session-access";
import { deviceKeyPort } from "@/src/adapters/device-key";
import { actionBadge, actionLockIcon } from "@/src/adapters/badge";
import { alarmTimer } from "@/src/adapters/timer";
import { browserDownloads, watchDownloadHistory } from "@/src/adapters/downloads";
import { createBrowserTabs } from "@/src/adapters/tabs";
import { BACKGROUND_MESSAGES, type BackgroundMessage } from "@/src/dispatch/methods";
import { callerContext, externalCallerContext } from "@/src/sender";
import { handleInstalledSitePages } from "@/src/site-pages";
import { createRuntime } from "@/src/runtime/create-runtime";
import type { Platform } from "@/src/runtime/platform";

/**
 * The background service worker: the extension's `Platform` and the
 * Chrome events and messages that reach `createRuntime`'s dispatcher.
 * Every message's caller is built from Chrome's `sender`, never from
 * anything the message body claims.
 */
const messenger = defineExtensionMessaging<ProtocolMap>();
const extensionBaseUrl = browser.runtime.getURL("");

void restrictSessionStorageToTrustedContexts();

const storage = new WxtStoragePort();
const platform: Platform = {
  storage,
  sessionKeys: sessionKeyStore,
  approvalPresenter: new WindowApprovalPresenter(storage),
  timer: alarmTimer,
  deviceKey: deviceKeyPort,
  badge: actionBadge,
  lockIndicator: actionLockIcon,
  downloads: browserDownloads,
  tabs: createBrowserTabs(messenger),
  version: () => browser.runtime.getManifest().version,
};
// Synchronous at the top level: it adds the alarm and window listeners that
// MV3 only delivers a waking event to when added in the worker's first turn.
const runtime = createRuntime(platform);

// No runtime.onSuspend handler clears the key cache. onSuspend fires when
// the worker idles out (~30s), not only on browser shutdown, so clearing
// there locked every wallet behind the user's back. The keys live in the
// keyring offscreen document and the session entries in
// chrome.storage.session, both memory-only and both outliving the worker.

function registerMessage(type: BackgroundMessage): void {
  messenger.onMessage(
    type,
    (message) => runtime.dispatch(type, message.data, callerContext(message.sender, extensionBaseUrl)) as never,
  );
}

for (const type of Object.keys(BACKGROUND_MESSAGES) as BackgroundMessage[]) registerMessage(type);

export default defineBackground(() => {
  listenForKeyringConnections();
  // Runs synchronously after the module's listeners are registered, so it
  // takes the session lock before any event this wake-up delivers.
  runtime.start();

  // Registration above runs at module-evaluation time: `onMessage` must
  // be called once per JS context, not per `defineBackground` invocation,
  // since MV3 service workers only evaluate this module once per
  // wake-up.
  //
  // The site's pages (SITE_MESSAGES): welcome.html hands over a Gleam
  // Points invite code, attest.html a scan attestation to sign. Returning
  // true keeps the reply channel open until the handler is done, which for
  // an attestation is when the user has finished in its window.
  browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    void runtime.dispatchSite(message, externalCallerContext(sender)).then(sendResponse);
    return true;
  });

  browser.runtime.onStartup.addListener(() => runtime.onBrowserStartup());

  browser.tabs.onRemoved.addListener((tabId) => runtime.onTabClosed(tabId));

  watchDownloadHistory(browser.runtime.id);

  browser.idle.onStateChanged.addListener((state) => runtime.onIdleStateChanged(state));

  // `runtime.onInstalled` fires on install and update, not on every
  // service-worker wake-up.
  browser.runtime.onInstalled.addListener((details) => {
    runtime.onInstalled(details.reason);
    // Dev builds reload constantly; opening the site from them would
    // inflate the install and uninstall counts.
    if (import.meta.env.PROD) {
      handleInstalledSitePages(details.reason, {
        version: browser.runtime.getManifest().version,
        openTab: (url) => browser.tabs.create({ url }),
        setUninstallUrl: (url) => browser.runtime.setUninstallURL(url),
      }).catch(() => {
        // A failed tab or uninstall URL must never break install.
      });
    }
  });
});
