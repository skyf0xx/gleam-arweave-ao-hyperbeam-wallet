import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { getTransferOutcome } from "./result";

/*
 * The CU's reply is untrusted: any status, any body. Reading it never
 * throws, and only a reply that carries an error reads as failed.
 */

const MESSAGE_ID = "m".repeat(43);
const PROCESS_ID = "p".repeat(43);

const tagName = fc.oneof(fc.constantFrom("Action", "action", "Error", "error"), fc.string({ maxLength: 8 }));
const tagValue = fc.oneof(fc.constantFrom("Transfer-Error", "transfer-error", "Debit-Notice", "Insufficient Balance!", ""), fc.string({ maxLength: 8 }));
const tag = fc.oneof({ weight: 4, arbitrary: fc.record({ name: tagName, value: tagValue }) }, fc.jsonValue({ maxDepth: 1 }));
const tagList = fc.oneof({ weight: 4, arbitrary: fc.array(tag, { maxLength: 4 }) }, fc.jsonValue({ maxDepth: 1 }));
const message = fc.oneof(
  { weight: 4, arbitrary: fc.record({ Tags: tagList, tags: tagList, Data: fc.jsonValue({ maxDepth: 1 }) }, { requiredKeys: [] }) },
  fc.jsonValue({ maxDepth: 1 }),
);
const messages = fc.oneof({ weight: 4, arbitrary: fc.array(message, { maxLength: 4 }) }, fc.jsonValue({ maxDepth: 1 }));

/** A CU result as a node might send it, with neither error field set. */
const errorFree = fc.record({ Messages: messages, messages, Output: fc.jsonValue({ maxDepth: 1 }) }, { requiredKeys: [] });
const reply = fc.oneof(
  { weight: 3, arbitrary: errorFree },
  fc.record({ Error: fc.jsonValue({ maxDepth: 1 }), error: fc.jsonValue({ maxDepth: 1 }), Messages: messages }, { requiredKeys: [] }),
  fc.jsonValue(),
);

const respond = (body: string, status = 200): typeof fetch => async () => new Response(body, { status });

const read = (fetchImpl: typeof fetch) => getTransferOutcome(MESSAGE_ID, PROCESS_ID, undefined, fetchImpl);

/** Whether the reply names a Transfer-Error anywhere, so a property can rule one in or out. */
const mentionsTransferError = (body: unknown) => JSON.stringify(body).includes('"Transfer-Error"');

describe("getTransferOutcome on any CU reply", () => {
  it("resolves to one of the three outcomes for any status and body", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(reply.map((body) => JSON.stringify(body)), fc.string()), fc.integer({ min: 200, max: 599 }), async (body, status) => {
        const outcome = await read(respond(body, status));
        if (status >= 300) expect(outcome).toEqual({ status: "pending" });
        if (outcome.status === "failed") expect(typeof outcome.error).toBe("string");
        else expect(outcome).toEqual({ status: expect.stringMatching(/^(confirmed|pending)$/) });
      }),
      { numRuns: 500 },
    );
  });

  it("is confirmed when the reply carries no error at all", async () => {
    await fc.assert(
      fc.asyncProperty(errorFree, async (body) => {
        fc.pre(!mentionsTransferError(body));
        expect(await read(respond(JSON.stringify(body)))).toEqual({ status: "confirmed" });
      }),
      { numRuns: 300 },
    );
  });

  it("is failed with the handler's error when the reply carries one", async () => {
    const thrown = fc.oneof(fc.string({ minLength: 1, maxLength: 20 }), fc.jsonValue({ maxDepth: 1 }).filter(Boolean));
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("Error", "error"), thrown, messages, async (field, value, list) => {
        const error = typeof value === "string" ? value : JSON.stringify(value);
        expect(await read(respond(JSON.stringify({ [field]: value, Messages: list })))).toEqual({ status: "failed", error });
      }),
      { numRuns: 200 },
    );
  });

  it("is failed with the reason once a Transfer-Error reply is among the messages", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(message, { maxLength: 4 }),
        fc.nat(),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (others, position, reason) => {
          fc.pre(!mentionsTransferError(others));
          const rejection = { Tags: [{ name: "Action", value: "Transfer-Error" }, { name: "Error", value: reason }] };
          const list = [...others];
          list.splice(position % (list.length + 1), 0, rejection);
          expect(await read(respond(JSON.stringify({ Messages: list })))).toEqual({ status: "failed", error: reason });
        },
      ),
      { numRuns: 300 },
    );
  });
});
