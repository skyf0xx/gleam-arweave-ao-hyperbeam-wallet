/**
 * Content-Security-Policy for extension pages and the background service
 * worker. `connect-src` stays scheme-wide (`https:`) rather than a host
 * allowlist because users add their own gateways and HyperBEAM peers at
 * runtime. `default-src` is deliberately unset so remote images (token
 * logos, NFT thumbnails) stay unrestricted.
 *
 * `pnpm dev` pages reach the WXT/Vite dev server over plain http and ws on
 * localhost for live reload, which `connect-src https:` would block, so
 * serve builds add those origins. WXT itself appends the dev server to
 * `script-src`.
 */
export function extensionPagesCsp(command: "build" | "serve"): string {
  const connectSrc = command === "serve" ? "https: http://localhost:* ws://localhost:*" : "https:";
  return `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'; connect-src ${connectSrc}`;
}
