import { describe, expect, it } from "vitest";
import type { WindowPort } from "./windows";
import type { RuntimePort, RuntimeMessage } from "./runtime";

describe("WindowPort", () => {
  it("is satisfiable by a plain in-memory implementation", async () => {
    const opened: string[] = [];
    const port: WindowPort = {
      async createApprovalWindow(url) {
        opened.push(url);
      },
      async closeApprovalWindow() {},
      async focusApprovalWindow() {},
    };

    await port.createApprovalWindow("/approval.html?requestId=req-1");
    expect(opened).toEqual(["/approval.html?requestId=req-1"]);
  });
});

describe("RuntimePort", () => {
  it("is satisfiable by a plain in-memory implementation round-tripping a message", async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>();
    const port: RuntimePort = {
      async send<TPayload, TResponse>(message: RuntimeMessage<TPayload>) {
        const handler = handlers.get(message.type);
        if (!handler) throw new Error(`no handler for ${message.type}`);
        return (await handler(message.payload)) as TResponse;
      },
      onMessage(type, handler) {
        handlers.set(type, handler as (payload: unknown) => unknown);
        return () => handlers.delete(type);
      },
    };

    const unsubscribe = port.onMessage<{ address: string }, { ok: boolean }>(
      "ping",
      (payload) => ({ ok: payload.address === "abc" }),
    );

    const response = await port.send<{ address: string }, { ok: boolean }>({
      type: "ping",
      payload: { address: "abc" },
    });

    expect(response).toEqual({ ok: true });
    unsubscribe();
  });
});
