import type {
  AppPlatform,
  BiometricUnlockPort,
  QrScannerPort,
  StoreReviewPort,
} from "@gleam/app/src/app-platform/types.ts";
import type { DappBrowserEvent } from "@gleam/app/src/app-platform/types.ts";
import type { MobileDappBrowser } from "../adapters/dapp-browser";
import type { FileSaver } from "../adapters/download-channel";
import type { SqliteStore, StoredRow } from "../adapters/sqlite-channel";

/** An address that passes the send form's recipient check, standing in for a scanned code. */
const SAMPLE_QR_TEXT = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";

export interface PreviewPorts {
  store: SqliteStore;
  fileSaver: FileSaver;
  biometrics: BiometricUnlockPort;
  qrScanner: QrScannerPort;
  storeReview: StoreReviewPort;
  dappBrowser: MobileDappBrowser;
  capabilities: Pick<AppPlatform["capabilities"], "biometrics" | "qrScanner">;
}

/** Everything is lost on reload, which is what a throwaway preview wants. */
function createMemoryStore(): SqliteStore {
  const rows = new Map<string, string>();
  return {
    async load() {
      return [...rows].map(([key, json]): StoredRow => [key, json]);
    },
    async write(puts, deletes) {
      for (const [key, json] of puts) rows.set(key, json);
      for (const key of deletes) rows.delete(key);
    },
  };
}

/**
 * There is no native page view in a desktop browser, so the screen's
 * placeholder stands in for it and every page "loads" at once.
 */
function createPreviewDappBrowser(): MobileDappBrowser {
  const listeners = new Set<(event: DappBrowserEvent) => void>();
  return {
    async open({ url }) {
      for (const listener of listeners) listener({ kind: "navigation", url, canGoBack: false, loading: false });
    },
    close: async () => {},
    goBack: async () => {},
    reload: async () => {},
    setFrame: async () => {},
    setHidden: async () => {},
    clearSiteData: async () => {},
    setSheetUp: async () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createPreviewPorts(): PreviewPorts {
  applyPreviewInsets();
  return {
    store: createMemoryStore(),
    fileSaver: {
      async save({ filename }) {
        // The bytes can be a keyfile, so only the name is ever logged.
        console.info(`[preview] would share ${filename}`);
        return { ok: true, filename };
      },
    },
    biometrics: {
      availability: async () => ({ available: false, reason: "unavailable" }),
      isEnrolled: async () => false,
      enrol: async () => {},
      readPassword: async () => {
        throw new Error("Biometrics aren't available in the browser preview.");
      },
      remove: async () => {},
    },
    qrScanner: { scan: async () => SAMPLE_QR_TEXT },
    storeReview: { opensPage: false, request: async () => {} },
    dappBrowser: createPreviewDappBrowser(),
    capabilities: { biometrics: false, qrScanner: true },
  };
}

/** iPhone 15's portrait insets, for `?insets=notch`. */
const NOTCH_INSETS = { top: "59px", right: "0px", bottom: "34px", left: "0px" };

/**
 * A desktop browser reports no safe-area insets, so `?insets=notch` stands
 * in a notched phone's by overriding the custom properties the phone layout
 * reads (`--safe-*` in packages/ui's theme.css).
 */
export function applyPreviewInsets(search: string = window.location.search): void {
  if (new URLSearchParams(search).get("insets") !== "notch") return;
  const style = document.documentElement.style;
  style.setProperty("--safe-top", NOTCH_INSETS.top);
  style.setProperty("--safe-right", NOTCH_INSETS.right);
  style.setProperty("--safe-bottom", NOTCH_INSETS.bottom);
  style.setProperty("--safe-left", NOTCH_INSETS.left);
}
