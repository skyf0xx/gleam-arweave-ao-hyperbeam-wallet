/**
 * The response body as text, or null when it runs past `maxBytes`. Reads
 * the stream in chunks and cancels it as soon as the cap is passed, so an
 * oversized body is never buffered; a `Content-Length` over the cap is
 * refused without reading at all.
 *
 * Anyone can announce a HyperBEAM node, so a peer's reply is read through
 * this rather than `text()`/`json()`, which would buffer whatever it sends.
 */
export async function readCappedText(response: Response, maxBytes: number): Promise<string | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();
}
