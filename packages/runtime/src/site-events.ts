import { missingPermissions, isWatchWalletMethod } from "@gleam/core";
import { isSecureSigningOrigin } from "@gleam/core/src/policy/index.ts";
import {
  PROVIDER_EVENT,
  type ConnectEventPayload,
  type DisconnectEventPayload,
  type ProviderEventName,
  type WalletSwitchEventPayload,
} from "@gleam/messaging/src/page-protocol.ts";
import type { ApprovalHandler } from "./handlers/approval";
import { webOrigin, type SiteWalletHandler } from "./handlers/site-wallet";
import type { TabsPort } from "./platform";

interface SiteEventsDeps {
  tabs: TabsPort;
  siteWallet: SiteWalletHandler;
  approval: Pick<ApprovalHandler, "findActiveGrant" | "getConnectedApps">;
  activeWallet: () => Promise<{ address: string; method: Parameters<typeof isWatchWalletMethod>[0] } | null>;
}

/**
 * What the wallet tells open pages when access or the active wallet changes:
 * pushes to the tabs on an origin, and the announcements built from them.
 */
export function createSiteEvents({ tabs, siteWallet, approval, activeWallet }: SiteEventsDeps) {
  /**
   * Finds every open tab whose URL origin matches `origin` exactly, since
   * nothing about `providerEvent`'s wire shape itself carries an origin
   * check. A tab query can't express "exact origin, any path" directly, so
   * this filters every web tab down to an exact
   * `new URL(tab.url).origin === origin` match by hand.
   */
  async function findTabsForOrigin(origin: string): Promise<number[]> {
    const ids: number[] = [];
    for (const tab of await tabs.webTabs()) {
      if (typeof tab.id !== "number" || !tab.url) continue;
      if (webOrigin(tab.url) === origin) ids.push(tab.id);
    }
    return ids;
  }

  /** The favicon of an open tab on `origin`, to keep on its grant. */
  async function favIconFor(origin: string): Promise<string | null> {
    try {
      for (const tab of await tabs.webTabs()) {
        if (!tab.url || !tab.favIconUrl) continue;
        if (webOrigin(tab.url) === origin) return tab.favIconUrl;
      }
    } catch {
      // A missing icon only means the letter fallback.
    }
    return null;
  }

  /**
   * Sends a `providerEvent` push to every tab currently showing `origin` —
   * never a broadcast to every open tab. The push names `origin`, and the
   * receiving page drops it if it has navigated elsewhere since the tab
   * query. Each send targets one `tabId`; a
   * tab with no content script listening (e.g. mid-navigation) simply
   * rejects that one send, which is swallowed here rather than failing the
   * caller — a missed push is not itself an error the connect/disconnect/
   * switchWallet flow should surface.
   */
  async function emitProviderEventToOrigin<TName extends ProviderEventName>(
    origin: string,
    event: TName,
    data: TName extends typeof PROVIDER_EVENT.CONNECT
      ? ConnectEventPayload
      : TName extends typeof PROVIDER_EVENT.DISCONNECT
        ? DisconnectEventPayload
        : WalletSwitchEventPayload,
  ): Promise<void> {
    const tabIds = await findTabsForOrigin(origin);
    await Promise.all(
      tabIds.map((tabId) =>
        tabs.send(tabId, "providerEvent", { origin, event, data }).catch(() => undefined),
      ),
    );
  }

  async function pushSiteWalletMode(origin: string, useGleam: boolean): Promise<void> {
    const tabIds = await findTabsForOrigin(origin);
    await Promise.all(
      tabIds.map((tabId) => tabs.send(tabId, "siteWalletMode", { origin, useGleam }).catch(() => undefined)),
    );
  }

  /**
   * For when the user ends a site's access from Gleam: the dApp hears
   * `disconnect`, and when another wallet is installed the page's
   * `window.arweaveWallet` goes back to forwarding to it. A dApp's own
   * `disconnect()` only does the first part.
   */
  async function announceAccessEnded(origin: string): Promise<void> {
    await siteWallet.setUseGleam(origin, false);
    await emitProviderEventToOrigin(origin, PROVIDER_EVENT.DISCONNECT, {});
    await pushSiteWalletMode(origin, false);
  }

  /**
   * For when the last wallet goes. Sites with a grant hear `disconnect` as
   * well; the rest were chosen in the popup and only switch back.
   */
  async function announceGleamSitesForgotten(revoked: string[]): Promise<void> {
    const forgotten = await siteWallet.forgetGleamSites();
    for (const origin of revoked) void announceAccessEnded(origin);
    for (const origin of forgotten) {
      if (!revoked.includes(origin)) void pushSiteWalletMode(origin, false);
    }
  }

  /** Reloads the active tab when it shows `origin`, so the dApp starts over with the wallet just chosen. */
  async function reloadActiveTabFor(origin: string): Promise<void> {
    const tab = await tabs.activeTab();
    if (typeof tab?.id !== "number" || !tab.url) return;
    if (webOrigin(tab.url) !== origin) return;
    await tabs.reload(tab.id).catch(() => undefined);
  }

  /**
   * The active address `origin` could read through `getActiveAddress`, or
   * `null`. Pushed events carry an address only through this, so a page
   * never hears one the pull path would refuse it.
   */
  async function readableActiveAddress(origin: string): Promise<string | null> {
    if (!isSecureSigningOrigin(origin)) return null;
    const grant = await approval.findActiveGrant(origin);
    if (!grant || missingPermissions("getActiveAddress", grant.permissions).length > 0) return null;
    const wallet = await activeWallet();
    if (!wallet || isWatchWalletMethod(wallet.method)) return null;
    return wallet.address;
  }

  /**
   * `walletSwitch` for an active-account change. A switch affects the whole
   * extension, so every origin with a grant is considered, never every
   * open tab, and each hears only the address it could read.
   */
  async function broadcastWalletSwitch(): Promise<void> {
    const grants = await approval.getConnectedApps();
    const origins = [...new Set(grants.map((grant) => grant.origin))];
    await Promise.all(
      origins.map(async (origin) => {
        const address = await readableActiveAddress(origin);
        if (address) await emitProviderEventToOrigin(origin, PROVIDER_EVENT.WALLET_SWITCH, { address });
      }),
    );
  }

  return {
    favIconFor,
    emitProviderEventToOrigin,
    pushSiteWalletMode,
    announceAccessEnded,
    announceGleamSitesForgotten,
    reloadActiveTabFor,
    readableActiveAddress,
    broadcastWalletSwitch,
  };
}
