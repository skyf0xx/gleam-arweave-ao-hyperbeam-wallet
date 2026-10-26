import { beforeEach, describe, expect, it, vi } from "vitest";

const scanBarcode = vi.hoisted(() => vi.fn());
const registerPlugin = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", () => ({ registerPlugin }));

import { QrScanError } from "@gleam/app/src/app-platform/qr-scanner.ts";
import { createQrScanner } from "./qr-scanner";

beforeEach(() => {
  scanBarcode.mockReset();
  registerPlugin.mockReset().mockReturnValue({ scanBarcode });
});

describe("createQrScanner", () => {
  it("resolves the scanned text and asks for QR codes only", async () => {
    scanBarcode.mockResolvedValue({ ScanResult: "hello", format: 0 });
    await expect(createQrScanner().scan()).resolves.toBe("hello");
    expect(registerPlugin).toHaveBeenCalledWith("CapacitorBarcodeScanner");
    expect(scanBarcode).toHaveBeenCalledWith(expect.objectContaining({ hint: 0, scanButton: false, cameraDirection: 1 }));
  });

  it("resolves null when the user closes the scanner", async () => {
    scanBarcode.mockImplementation(async () => {
      throw { code: "OS-PLUG-BARC-0006", message: "cancelled" };
    });
    await expect(createQrScanner().scan()).resolves.toBeNull();
  });

  it("rejects with permission-denied when the camera is off", async () => {
    scanBarcode.mockImplementation(async () => {
      throw { code: "OS-PLUG-BARC-0007", message: "denied" };
    });
    await expect(createQrScanner().scan()).rejects.toMatchObject({ name: "QrScanError", reason: "permission-denied" });
  });

  it("rejects with failed for anything else, such as an unsupported device", async () => {
    scanBarcode.mockImplementation(async () => {
      throw new Error("not implemented on web");
    });
    const error = await createQrScanner().scan().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QrScanError);
    expect(error).toMatchObject({ reason: "failed" });
  });
});
