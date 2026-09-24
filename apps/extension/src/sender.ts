/**
 * The parts of `runtime.MessageSender` the background uses to decide who
 * sent a message. Declared locally so these checks stay plain functions
 * with no dependency on the browser types.
 */
export interface MessageSenderLike {
  url?: string;
  origin?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}

/**
 * True when the message came from one of this extension's own pages (popup,
 * side panel, approval window). `extensionBaseUrl` is
 * `runtime.getURL("")`. Content scripts report the page's URL, so a
 * compromised or malicious page can never pass this check.
 */
export function isExtensionPageSender(sender: MessageSenderLike | undefined, extensionBaseUrl: string): boolean {
  return typeof sender?.url === "string" && sender.url.startsWith(extensionBaseUrl);
}

/**
 * The web origin a content-script message came from, or null when the
 * sender is not this extension's top-frame content script on an http(s)
 * page. The origin comes from Chrome's view of the sending frame, never
 * from the message body, so a page cannot claim to be another site.
 *
 * `sender.origin` is preferred because it reflects the document's real
 * origin: a page served with a CSP `sandbox` header has an http(s) URL but
 * an opaque ("null") origin, and must not act as that URL's site.
 */
export function contentScriptOrigin(sender: MessageSenderLike | undefined, extensionBaseUrl: string): string | null {
  if (!sender?.tab || typeof sender.url !== "string") return null;
  if (isExtensionPageSender(sender, extensionBaseUrl)) return null;
  // The content script runs in the top frame only (`allFrames: false`).
  if (sender.frameId !== undefined && sender.frameId !== 0) return null;

  let urlOrigin: string;
  try {
    const url = new URL(sender.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    urlOrigin = url.origin;
  } catch {
    return null;
  }

  if (sender.origin !== undefined && sender.origin !== urlOrigin) return null;
  return urlOrigin;
}
