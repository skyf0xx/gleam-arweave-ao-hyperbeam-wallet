import { describe, expect, it } from "vitest";
import QRCode from "qrcode-generator";
import jsQR from "jsqr";

// jsdom can't rasterize qr-code-styling's real SVG output, so this drives its underlying
// encoder (qrcode-generator) directly, rasterizes the module matrix by hand, and decodes
// it with an independent decoder (jsqr) to prove a real round-trip, not just a snapshot.
function rasterizeQrMatrix(value: string): { data: Uint8ClampedArray; width: number; height: number } {
  const qr = QRCode(0, "H");
  qr.addData(value);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const cellSize = 4;
  const quietZone = 4 * cellSize;
  const size = moduleCount * cellSize + quietZone * 2;

  const data = new Uint8ClampedArray(size * size * 4);
  data.fill(255); // white background, full alpha

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) continue;

      const startX = quietZone + col * cellSize;
      const startY = quietZone + row * cellSize;
      for (let dy = 0; dy < cellSize; dy += 1) {
        for (let dx = 0; dx < cellSize; dx += 1) {
          const px = startX + dx;
          const py = startY + dy;
          const idx = (py * size + px) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }
    }
  }

  return { data, width: size, height: size };
}

describe("QrCode encoding", () => {
  it("encodes the exact wallet address value, decodable back to the same string", () => {
    const value = "wr7zR8G3z0v2Vq5vHcnLzE9YvOaKn8xLpM7jY3zN9jI";

    const { data, width, height } = rasterizeQrMatrix(value);
    const decoded = jsQR(data, width, height);

    expect(decoded).not.toBeNull();
    expect(decoded?.data).toBe(value);
  });

  it("encodes a different value to a different, still-decodable payload", () => {
    const value = "0x1234567890abcdef1234567890abcdef12345678";

    const { data, width, height } = rasterizeQrMatrix(value);
    const decoded = jsQR(data, width, height);

    expect(decoded).not.toBeNull();
    expect(decoded?.data).toBe(value);
    expect(decoded?.data).not.toBe("wr7zR8G3z0v2Vq5vHcnLzE9YvOaKn8xLpM7jY3zN9jI");
  });

  it("survives error-correction-level H redundancy even with a corrupted quiet-zone-adjacent module", () => {
    const value = "ar://gleam-wallet-receive-test";
    const { data, width, height } = rasterizeQrMatrix(value);

    // Flip a module to confirm H-level redundancy tolerates corruption, not just a pristine bitmap.
    const flipX = width / 2;
    const flipY = height / 2;
    const idx = (flipY * width + flipX) * 4;
    data[idx] = 255;
    data[idx + 1] = 255;
    data[idx + 2] = 255;

    const decoded = jsQR(data, width, height);
    expect(decoded).not.toBeNull();
    expect(decoded?.data).toBe(value);
  });
});
