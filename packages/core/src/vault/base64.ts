/**
 * Base64 helpers built on the ambient `btoa`/`atob` (available in both a
 * browser/MV3 service worker and the Node test runner — no polyfill,
 * no `Buffer`, keeping this package free of any Node-specific global).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Accepts base64url with or without padding, as Arweave encodes keys and signatures. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(standard + "=".repeat((4 - (standard.length % 4)) % 4));
}
