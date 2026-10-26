import { registerPlugin } from "@capacitor/core";
import type {
  CapacitorBarcodeScannerOptions,
  CapacitorBarcodeScannerScanResult,
} from "@capacitor/barcode-scanner";
import type { QrScannerPort } from "@gleam/app/src/app-platform/types.ts";
import { QrScanError } from "@gleam/app/src/app-platform/qr-scanner.ts";

/**
 * Every call into the barcode plugin. Its own full-screen scanner asks for
 * the camera, so the app never calls a permission API itself.
 *
 * The plugin rejects with `OS-PLUG-BARC-<code>` on both platforms: 0006 is
 * the user closing the scanner, 0007 is the camera being denied.
 */
// The package's own entry point imports html5-qrcode (its web scanner) at
// load, which has no place in a wallet bundle. This registers the same
// native plugin: "CapacitorBarcodeScanner" is its `jsName` on iOS and its
// `@CapacitorPlugin` name on Android. Types only come from the package.
interface BarcodeScannerPlugin {
  scanBarcode(options: CapacitorBarcodeScannerOptions): Promise<CapacitorBarcodeScannerScanResult>;
}

// CapacitorBarcodeScannerTypeHint.QR_CODE.
const QR_CODE = 0;

const CANCELLED = "OS-PLUG-BARC-0006";
const CAMERA_DENIED = "OS-PLUG-BARC-0007";

export function createQrScanner(): QrScannerPort {
  const BarcodeScanner = registerPlugin<BarcodeScannerPlugin>("CapacitorBarcodeScanner");
  return {
    scan: async () => {
      try {
        // iOS decodes every field below as required; the package's wrapper
        // fills them with these defaults (back camera, adaptive orientation).
        const result = await BarcodeScanner.scanBarcode({
          hint: QR_CODE,
          scanInstructions: " ",
          scanButton: false,
          scanText: " ",
          cameraDirection: 1,
          scanOrientation: 3,
        });
        return result.ScanResult;
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === CANCELLED) return null;
        if (code === CAMERA_DENIED) {
          throw new QrScanError("permission-denied", "Camera access is off for Gleam.");
        }
        throw new QrScanError("failed", error instanceof Error ? error.message : String(error));
      }
    },
  };
}
