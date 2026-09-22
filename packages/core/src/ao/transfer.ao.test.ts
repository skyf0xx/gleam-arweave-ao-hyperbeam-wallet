import { describe, expect, it, vi, beforeEach } from "vitest";
import { AO_TRANSFER_HAS_NO_FEE, submitTransfer } from "./transfer";

const messageMock = vi.fn();
const connectMock = vi.fn<(config: unknown) => { message: typeof messageMock }>(() => ({
  message: messageMock,
}));

vi.mock("@permaweb/aoconnect/browser", () => ({
  connect: (arg: unknown) => connectMock(arg),
}));

vi.mock("@dha-team/arbundles/web", () => ({
  ArweaveSigner: vi.fn().mockImplementation(() => ({
    publicKey: new Uint8Array(32),
    sign: vi.fn().mockResolvedValue(new Uint8Array(64)),
  })),
}));

const PROCESS_ID = "processABC";
const RECIPIENT = "recipientXYZ";
const JWK = { kty: "RSA", n: "fake-n", e: "AQAB" } as unknown as Parameters<typeof submitTransfer>[0];

beforeEach(() => {
  connectMock.mockClear();
  messageMock.mockReset();
});

describe("AO submitTransfer", () => {
  it("connects in legacy mode, using aoconnect's own default Messenger Unit", async () => {
    messageMock.mockResolvedValue("msg-id-1");
    await submitTransfer(JWK, PROCESS_ID, RECIPIENT, "1000000000000");

    expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({ MODE: "legacy" }));
  });

  it("posts an ao.TN.1 Transfer message with the process, capitalized tags, matching the legacynet MU protocol", async () => {
    messageMock.mockResolvedValue("msg-id-1");
    await submitTransfer(JWK, PROCESS_ID, RECIPIENT, "42");

    expect(messageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        process: PROCESS_ID,
        tags: [
          { name: "Data-Protocol", value: "ao" },
          { name: "Variant", value: "ao.TN.1" },
          { name: "Type", value: "Message" },
          { name: "Action", value: "Transfer" },
          { name: "Recipient", value: RECIPIENT },
          { name: "Quantity", value: "42" },
        ],
      }),
    );
  });

  it("returns the messageId aoconnect's message() resolves with", async () => {
    messageMock.mockResolvedValue("msg-id-42");
    const result = await submitTransfer(JWK, PROCESS_ID, RECIPIENT, "42");
    expect(result).toEqual({ messageId: "msg-id-42" });
  });

  it("preserves large atomic-integer amounts exactly as strings, never floats", async () => {
    messageMock.mockResolvedValue("msg-id-1");
    const huge = "90071992547409930000";
    await submitTransfer(JWK, PROCESS_ID, RECIPIENT, huge);

    const call = messageMock.mock.calls[0]?.[0] as { tags: Array<{ name: string; value: string }> };
    const quantityTag = call.tags.find((tag) => tag.name === "Quantity");
    expect(quantityTag?.value).toBe(huge);
    expect(typeof quantityTag?.value).toBe("string");
  });

  it("throws a descriptive error if aoconnect's message() returns a non-string result", async () => {
    messageMock.mockResolvedValue({ slot: "1", id: "msg-id-1" });
    await expect(submitTransfer(JWK, PROCESS_ID, RECIPIENT, "1")).rejects.toThrow(
      /Unexpected aoconnect message\(\) result/,
    );
  });

  it("propagates a rejection from aoconnect's message() (e.g. MU unreachable)", async () => {
    messageMock.mockRejectedValue(new Error("network error"));
    await expect(submitTransfer(JWK, PROCESS_ID, RECIPIENT, "1")).rejects.toThrow(/network error/);
  });
});

describe("AO_TRANSFER_HAS_NO_FEE", () => {
  it("is explicit that AO transfers have no sender-side fee quote, unlike AR", () => {
    expect(AO_TRANSFER_HAS_NO_FEE).toBe(true);
  });
});
