export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** A fetch that gives every request its own timeout, so one hung host can't hold a scan past its budget. */
export function withRequestTimeout(fetchImpl: typeof fetch, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): typeof fetch {
  return ((input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })) as typeof fetch;
}

/** A 2xx status. */
export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * The body as text, or `null` once it runs past `maxBytes`: a reply that
 * should be one short value can't make the reader buffer a hostile host's
 * gigabytes. Reading stops at the cap.
 */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
