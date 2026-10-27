import type { DappBrowserPort } from "@gleam/app/src/app-platform/types.ts";
import type { DappViewPlugin } from "@gleam/dapp-view";
import type { DappBridge } from "./dapp-bridge";

export type DappBrowserPlugin = Pick<DappViewPlugin, "goBack" | "reload" | "setFrame" | "clearData" | "addListener">;

export interface MobileDappBrowser extends DappBrowserPort {
  /** The approval sheet is up, so the page stays hidden under it however the screen asks. */
  setSheetUp(up: boolean): Promise<void>;
}

/**
 * The browser screen's port over the dApp bridge. Pages open and close only
 * through the bridge, so the runtime hears every tab close. The native view
 * is hidden for either of two reasons, the screen drawing over it or the
 * approval sheet, and a new page opens under the sheet hidden too.
 */
export function createDappBrowser({ bridge, plugin }: { bridge: DappBridge; plugin: DappBrowserPlugin }): MobileDappBrowser {
  let sheetUp = false;
  let screenCovers = false;
  const apply = () => bridge.setHidden(sheetUp || screenCovers);

  return {
    async open(options) {
      screenCovers = false;
      await bridge.open(options);
      if (sheetUp) await apply();
    },
    async close() {
      screenCovers = false;
      await bridge.close();
    },
    goBack: () => plugin.goBack(),
    reload: () => plugin.reload(),
    setFrame: (frame) => plugin.setFrame({ frame }),
    setHidden(hidden) {
      screenCovers = hidden;
      return apply();
    },
    async clearSiteData() {
      // The plugin closes the view itself, which would leave the runtime holding a tab that is gone.
      await bridge.close();
      await plugin.clearData();
    },
    setSheetUp(up) {
      sheetUp = up;
      return apply();
    },
    subscribe(listener) {
      const handles = [
        plugin.addListener("navigation", (event) => listener({ kind: "navigation", ...event })),
        plugin.addListener("loadError", (event) => listener({ kind: "loadError", ...event })),
      ];
      return () => {
        for (const handle of handles) handle.then((registered) => registered.remove()).catch(() => undefined);
      };
    },
  };
}
