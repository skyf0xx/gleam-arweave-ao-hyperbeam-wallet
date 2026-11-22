import { useEffect, useState } from "react";

/**
 * Arweave images kept on the device by tx id. The bytes behind a tx id can
 * never change, so an entry never expires. Gateways send them with no
 * caching headers, so without this every popup open refetches each one
 * through the gateway's sandbox redirect. Keyed by tx id rather than URL
 * so a gateway switch keeps the cache.
 */
export interface ImageCacheOptions {
  /** Cache Storage name. */
  name: string;
  /** Host of the never-fetched key URLs; Cache API keys must be http(s) requests. */
  keyHost: string;
  maxEntries: number;
  /** Whether a response's content type may be stored and drawn from a blob URL. */
  accepts: (contentType: string) => boolean;
  /** Larger bodies are drawn from the plain URL instead. */
  maxBytes?: number;
}

/** A body worth keeping: some gateways answer 200 with an empty body, and a flaky link can cut one short. */
function complete(bytes: ArrayBuffer, contentLength: string | null): boolean {
  if (bytes.byteLength === 0) return false;
  const declared = contentLength === null ? NaN : Number(contentLength);
  return Number.isNaN(declared) || declared === bytes.byteLength;
}

/** `/raw/<id>` is where collectible media loads from (`core/ao/collectibles.ts`). */
const TX_ID_PATH = /^\/(?:raw\/)?([A-Za-z0-9_-]{43})$/;

function txIdOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return TX_ID_PATH.exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function cacheAvailable(): boolean {
  return typeof caches !== "undefined" && typeof URL.createObjectURL === "function";
}

function mediaType(contentType: string): string {
  return contentType.split(";")[0]!.trim().toLowerCase();
}

export interface ImageCache {
  /**
   * The `src` to draw `url` with: a cached object URL for an Arweave tx-id
   * image, the URL itself for anything else or when the cache can't serve
   * it, and `undefined` while the cache is being read.
   */
  useCachedImage: (url: string | null | undefined, attempt?: number) => string | null | undefined;
  /** Drops a stored copy that wouldn't draw, so the next attempt fetches it again. */
  forget: (url: string) => void;
  /** Test hook: forgets the in-memory object URLs. */
  resetForTests: () => void;
}

export function createImageCache(options: ImageCacheOptions): ImageCache {
  const { name, keyHost, maxEntries, accepts, maxBytes = Infinity } = options;
  /** Object URLs live for the page's lifetime, shared by every element that shows the image. */
  const resolved = new Map<string, string>();
  const pending = new Map<string, Promise<string | null>>();

  const cacheKey = (txId: string) => `https://${keyHost}/${txId}`;

  async function trim(cache: Cache): Promise<void> {
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
  }

  /** An object URL for the image, or null when it can't be fetched (the caller falls back to the plain URL). */
  async function load(txId: string, url: string): Promise<string | null> {
    const cache = await caches.open(name);
    const hit = await cache.match(cacheKey(txId));
    if (hit) {
      const type = mediaType(hit.headers.get("content-type") ?? "");
      const bytes = await hit.arrayBuffer();
      if (accepts(type) && bytes.byteLength > 0) return URL.createObjectURL(new Blob([bytes], { type }));
      await cache.delete(cacheKey(txId));
    }

    const response = await fetch(url, { referrerPolicy: "no-referrer", credentials: "omit" });
    const type = mediaType(response.headers.get("content-type") ?? "");
    if (!response.ok || !accepts(type)) return null;
    const bytes = await response.arrayBuffer();
    if (!complete(bytes, response.headers.get("content-length")) || bytes.byteLength > maxBytes) return null;
    await cache.put(cacheKey(txId), new Response(bytes, { headers: { "content-type": type } }));
    void trim(cache).catch(() => undefined);
    // Typed from the checked header, so the blob is only ever what was accepted.
    return URL.createObjectURL(new Blob([bytes], { type }));
  }

  function cached(txId: string, url: string): Promise<string | null> {
    let promise = pending.get(txId);
    if (!promise) {
      promise = load(txId, url)
        .catch(() => null)
        .then((objectUrl) => {
          if (objectUrl) resolved.set(txId, objectUrl);
          else pending.delete(txId);
          return objectUrl;
        });
      pending.set(txId, promise);
    }
    return promise;
  }

  function forget(url: string): void {
    const txId = txIdOf(url);
    if (!txId) return;
    const objectUrl = resolved.get(txId);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    resolved.delete(txId);
    pending.delete(txId);
    if (cacheAvailable()) void caches.open(name).then((cache) => cache.delete(cacheKey(txId))).catch(() => undefined);
  }

  /** `attempt` reads the image again when it changes, after a failed draw. */
  function useCachedImage(url: string | null | undefined, attempt = 0): string | null | undefined {
    const txId = url && cacheAvailable() ? txIdOf(url) : null;
    const [loaded, setLoaded] = useState<{ txId: string; attempt: number; src: string } | null>(null);

    useEffect(() => {
      if (!txId || !url || resolved.has(txId)) return;
      let live = true;
      void cached(txId, url).then((objectUrl) => {
        if (live) setLoaded({ txId, attempt, src: objectUrl ?? url });
      });
      return () => {
        live = false;
      };
    }, [txId, url, attempt]);

    if (!url) return null;
    if (!txId) return url;
    return resolved.get(txId) ?? (loaded?.txId === txId && loaded.attempt === attempt ? loaded.src : undefined);
  }

  return {
    useCachedImage,
    forget,
    resetForTests: () => {
      resolved.clear();
      pending.clear();
    },
  };
}
