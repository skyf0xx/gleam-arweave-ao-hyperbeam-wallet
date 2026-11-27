import { describe, expect, it } from "vitest";
import { readTextCapped } from "./http";

function streamed(chunks: string[]): { response: Response; pulled: () => number } {
  let pulled = 0;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks.length) return controller.close();
      controller.enqueue(encoder.encode(chunks[pulled++]));
    },
  });
  return { response: new Response(body), pulled: () => pulled };
}

describe("readTextCapped", () => {
  it("returns a body within the cap, joined across chunks", async () => {
    expect(await readTextCapped(streamed(["6556", "1299"]).response, 8)).toBe("65561299");
  });

  it("stops reading once the body runs past the cap", async () => {
    const { response, pulled } = streamed(["x".repeat(40), "x".repeat(40), "x".repeat(40), "x".repeat(40)]);
    expect(await readTextCapped(response, 64)).toBeNull();
    expect(pulled()).toBeLessThan(4);
  });

  it("reads an empty body as empty text", async () => {
    expect(await readTextCapped(new Response(null), 64)).toBe("");
  });
});
