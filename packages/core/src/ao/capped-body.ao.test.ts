import { describe, expect, it } from "vitest";
import { readCappedText } from "./capped-body";

function streamed(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled < chunks.length) controller.enqueue(encoder.encode(chunks[pulled++]!));
      else controller.close();
    },
  });
  return new Response(body, { headers });
}

describe("readCappedText", () => {
  it("returns a body within the cap", async () => {
    expect(await readCappedText(streamed(["12", "34"]), 8)).toBe("1234");
  });

  it("stops reading once the body passes the cap", async () => {
    const chunks = Array.from({ length: 100 }, () => "x".repeat(10));
    expect(await readCappedText(streamed(chunks), 50)).toBeNull();
  });

  it("refuses a declared length over the cap without reading", async () => {
    expect(await readCappedText(streamed(["1"], { "content-length": "9999" }), 100)).toBeNull();
  });
});
