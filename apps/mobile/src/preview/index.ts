import type {
  AppPlatform,
  BiometricUnlockPort,
  QrScannerPort,
  StoreReviewPort,
} from "@gleam/app/src/app-platform/types.ts";
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

export function createPreviewPorts(): PreviewPorts {
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
    capabilities: { biometrics: false, qrScanner: true },
  };
}
