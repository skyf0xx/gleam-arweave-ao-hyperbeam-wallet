import { describe, expect, it, vi } from "vitest";
import { AO_LEGACY_CU_URL, getTransferOutcome } from "./result";

const MESSAGE_ID = "msg-id-1";
const PROCESS_ID = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";

function respond(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe("getTransferOutcome", () => {
  it("reads the message's result from the CU, scoped to the token process", async () => {
    const fetchImpl = respond({ Messages: [] });
    await getTransferOutcome(MESSAGE_ID, PROCESS_ID, undefined, fetchImpl);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${AO_LEGACY_CU_URL}/result/${MESSAGE_ID}?process-id=${PROCESS_ID}`);
  });

  it("is confirmed when the process replied without an error (Debit-Notice)", async () => {
    const fetchImpl = respond({
      Messages: [{ Target: "sender", Tags: [{ name: "Action", value: "Debit-Notice" }] }],
    });
    await expect(getTransferOutcome(MESSAGE_ID, PROCESS_ID, undefined, fetchImpl)).resolves.toEqual({
      status: "confirmed",
    });
  });

  it("is failed with the process's reason when it replied Transfer-Error", async () => {
    const fetchImpl = respond({
      Messages: [
        {
          Tags: [
            { name: "Action", value: "Transfer-Error" },
            { name: "Error", value: "Insufficient Balance!" },
          ],
        },
      ],
    });
    await expect(getTransferOutcome(MESSAGE_ID, PROCESS_ID, undefined, fetchImpl)).resolves.toEqual({
      status: "failed",
      error: "Insufficient Balance!",
    });
  });

  it("is failed when the handler threw (top-level Error)", async () => {
    const fetchImpl = respond({ Error: "handler exploded", Messages: [] });
    await expect(getTransferOutcome(MESSAGE_ID, PROCESS_ID, undefined, fetchImpl)).resolves.toEqual({
      status: "failed",
      error: "handler exploded",
    });
  });

  it("stays pending when the CU hasn't evaluated the message yet", async () => {
    const fetchImpl = respond({ error: "not found" }, 404);
    await expect(getTransferOutcome(MESSAGE_ID, PROCESS_ID, undefined, fetchImpl)).resolves.toEqual({
      status: "pending",
    });
  });

  it("stays pending when the CU is unreachable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network error"));
    await expect(getTransferOutcome(MESSAGE_ID, PROCESS_ID, undefined, fetchImpl)).resolves.toEqual({
      status: "pending",
    });
  });
});
