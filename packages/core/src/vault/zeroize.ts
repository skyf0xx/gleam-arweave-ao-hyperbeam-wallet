/**
 * Overwrites plaintext key-material bytes in place. Callers are
 * responsible for invoking this in a `finally` block around every
 * encrypt/decrypt so the buffer is wiped on both success and error paths.
 *
 * Checks `ArrayBuffer.isView` rather than `instanceof Uint8Array`: a
 * `Uint8Array` crossing a realm boundary (e.g. one produced by a test
 * environment's own `TextEncoder`) fails `instanceof` against this
 * module's `Uint8Array` even though it is one, which would silently
 * skip zeroizing it.
 */
export function zeroize(buffer: Uint8Array | ArrayBuffer): void {
  const view = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  view.fill(0);
}
