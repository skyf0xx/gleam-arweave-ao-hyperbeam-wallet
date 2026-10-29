import type { DappViewMessage, DappViewNavigation, DappViewPlugin, DappViewRect } from "@gleam/dapp-view";
import {
  EVENT,
  OTHER_WALLET,
  PROVIDER_SURFACE_METHODS,
  REQUEST,
  RESPONSE,
  SITE_MODE,
  SITE_MODE_REQUEST,
  type PageEventEnvelope,
  type PageMessageEnvelope,
  type PageResponseEnvelope,
  type PageSiteModeEnvelope,
} from "@gleam/messaging/src/page-protocol.ts";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import type { TabPush, TabsPort } from "@gleam/runtime";
import { exposeMethods } from "./comlink-guard";
import { isExactWebOrigin, TABS_REQUEST } from "./dapp-tabs";

/** The runtime worker's entry for page messages (`RuntimeHost.pageCall`). */
export interface PageRuntime {
  pageCall(type: string, data: unknown, origin: string, tabId: number | undefined): Promise<unknown>;
  tabClosed(tabId: number): Promise<void>;
}

export type DappViewBridgePlugin = Pick<DappViewPlugin, "open" | "close" | "postMessage" | "reload" | "setHidden" | "addListener">;

export interface DappBridge {
  /** Opens `url` in the dApp view with Gleam's provider in every page. */
  open(options: { url: string; frame: DappViewRect }): Promise<void>;
  close(): Promise<void>;
  /**
   * The native view sits above the wallet WebView, so anything the wallet
   * draws over it (the approval sheet) has to hide it first.
   */
  setHidden(hidden: boolean): Promise<void>;
  /** The dApp view as the runtime's one browser tab, served to the worker by `serveDappTabs`. */
  tabs: TabsPort;
  /**
   * Calls `onChange` when the page in view opens, navigates or closes, so the
   * main screen's site card re-reads `tabs.activeTab()`.
   */
  subscribe(onChange: () => void): () => void;
}

function webOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * The origin a message may act as, or null when it must be dropped. Only
 * the top frame speaks for the page, matching the extension's
 * `allFrames: false`, and only an http(s) origin in its exact serialized
 * form passes: "null", file:, data:, about: and any other scheme don't.
 * The origin is the one native read from the sending frame, never
 * anything in the message.
 */
export function attestedOrigin(message: DappViewMessage): string | null {
  if (message.isMainFrame !== true) return null;
  return isExactWebOrigin(message.origin) ? message.origin : null;
}

function parseEnvelope(data: unknown): PageMessageEnvelope | null {
  if (typeof data !== "string") return null;
  let envelope: unknown;
  try {
    envelope = JSON.parse(data);
  } catch {
    return null;
  }
  return envelope !== null && typeof envelope === "object" && !Array.isArray(envelope)
    ? (envelope as PageMessageEnvelope)
    : null;
}

/**
 * The wallet half of the dApp view's bridge, the counterpart of the
 * extension's content script. A page's envelope reaches the runtime only
 * through `pageCall`, as the content-script tier on the attested origin,
 * so the dispatcher applies the same method table, grants and
 * secure-origin check it does in the extension.
 *
 * Every reply and push is addressed to an exact origin, and native
 * delivers it only while the main frame is still on that origin. A reply
 * goes to the origin the request came from, so a page that navigated
 * meanwhile never sees it.
 *
 * Each cross-origin load of the view gets a new tab id, so a push the
 * runtime meant for one site can't reach the next one through a reused id.
 * Like the extension's content script, which lives as long as one page,
 * the bridge relays a site-mode request once per tab id and each distinct
 * other-wallet report once.
 */
export function createDappBridge({
  plugin,
  runtime,
  providerScript,
}: {
  plugin: DappViewBridgePlugin;
  runtime: PageRuntime;
  providerScript: string;
}): DappBridge & { listening: Promise<void> } {
  let tab: { id: number; url: string } | null = null;
  let lastTabId = 0;
  const freshRelays = () => ({ modeAsked: false, presence: false, use: false, permissions: "" });
  let relayed = freshRelays();
  const subscribers = new Set<() => void>();
  const notify = () => {
    for (const onChange of [...subscribers]) onChange();
  };

  const replaceTab = (next: { id: number; url: string } | null): void => {
    if (tab) runtime.tabClosed(tab.id).catch(() => undefined);
    tab = next;
    relayed = freshRelays();
    notify();
  };

  const webTab = (): { id: number; url: string; origin: string } | null => {
    const origin = tab ? webOrigin(tab.url) : null;
    return tab && origin ? { ...tab, origin } : null;
  };

  const post = async (envelope: PageMessageEnvelope, targetOrigin: string): Promise<boolean> => {
    const { delivered } = await plugin.postMessage({ data: JSON.stringify(envelope), targetOrigin });
    return delivered;
  };

  const reply = (envelope: PageMessageEnvelope, origin: string): void => {
    post(envelope, origin).catch(() => undefined);
  };

  async function onMessage(message: DappViewMessage): Promise<void> {
    const origin = attestedOrigin(message);
    if (!origin) return;
    const envelope = parseEnvelope(message.data);
    if (!envelope) return;
    const current = webTab();
    const tabId = current?.origin === origin ? current.id : undefined;

    if (
      envelope.type === REQUEST &&
      typeof envelope.id === "string" &&
      PROVIDER_SURFACE_METHODS.includes(envelope.method)
    ) {
      const response: PageResponseEnvelope = { type: RESPONSE, id: envelope.id };
      try {
        response.result = await runtime.pageCall("providerCall", { method: envelope.method, params: envelope.params }, origin, tabId);
      } catch (error) {
        response.error = { message: error instanceof Error ? error.message : String(error) };
      }
      reply(response, origin);
    } else if (envelope.type === SITE_MODE_REQUEST) {
      if (relayed.modeAsked) return;
      relayed.modeAsked = true;
      const useGleam = await runtime.pageCall("getSiteWalletMode", undefined, origin, tabId).then(
        (mode) => (mode as { useGleam?: unknown } | null)?.useGleam === true,
        // Without an answer the other wallet keeps the site, so the page
        // shouldn't wait for one.
        () => false,
      );
      reply({ type: SITE_MODE, useGleam } satisfies PageSiteModeEnvelope, origin);
    } else if (envelope.type === OTHER_WALLET) {
      const { walletName, used, permissions } = envelope;
      if (Array.isArray(permissions)) {
        const key = permissions.join(",");
        if (key === relayed.permissions) return;
        relayed.permissions = key;
      } else {
        if (used ? relayed.use : relayed.presence) return;
        relayed.presence = true;
        if (used) relayed.use = true;
      }
      await runtime.pageCall("reportOtherWallet", { walletName, used, permissions }, origin, tabId).catch(() => undefined);
    }
  }

  function onNavigation({ url }: DappViewNavigation): void {
    if (typeof url !== "string") return;
    const origin = webOrigin(url);
    if (tab && origin !== null && webOrigin(tab.url) === origin) {
      tab.url = url;
      notify();
    } else {
      lastTabId += 1;
      replaceTab({ id: lastTabId, url });
    }
  }

  const tabs: TabsPort = {
    async webTabs() {
      const current = webTab();
      return current ? [{ id: current.id, url: current.url }] : [];
    },
    async activeTab() {
      const current = webTab();
      return current ? { id: current.id, url: current.url } : undefined;
    },
    async reload(tabId) {
      if (webTab()?.id === tabId) await plugin.reload();
    },
    async send<K extends TabPush>(tabId: number, type: K, data: Parameters<ProtocolMap[K]>[0]) {
      const current = webTab();
      if (!current || current.id !== tabId) throw new Error("That page is no longer open.");
      const envelope: PageEventEnvelope | PageSiteModeEnvelope =
        type === "providerEvent"
          ? { type: EVENT, ...(data as Parameters<ProtocolMap["providerEvent"]>[0]) }
          : { type: SITE_MODE, useGleam: (data as Parameters<ProtocolMap["siteWalletMode"]>[0]).useGleam };
      if (!(await post(envelope, current.origin))) throw new Error("That page is no longer open.");
    },
  };

  const listening = Promise.all([
    plugin.addListener("message", (message) => {
      void onMessage(message).catch(() => undefined);
    }),
    plugin.addListener("navigation", onNavigation),
  ]).then(() => undefined);

  return {
    async open({ url, frame }) {
      await plugin.open({ url, frame, providerScript });
      notify();
    },
    async close() {
      // The page is gone from the wallet's side even if native fails to say so.
      try {
        await plugin.close();
      } finally {
        replaceTab(null);
      }
    },
    setHidden: (hidden) => plugin.setHidden({ hidden }),
    tabs,
    subscribe(onChange) {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    },
    listening,
  };
}

/** Answers the runtime worker's `createWorkerTabs`. */
export function serveDappTabs(worker: Worker, tabs: TabsPort): void {
  let served = false;
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; port?: unknown } | null;
    if (served || data?.type !== TABS_REQUEST || !(data.port instanceof MessagePort)) return;
    served = true;
    exposeMethods(tabs, ["webTabs", "activeTab", "reload", "send"], data.port);
  });
}
