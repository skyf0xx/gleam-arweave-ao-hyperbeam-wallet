import { describe, expect, it, vi, beforeEach } from "vitest";
import { AO_TRANSFER_HAS_NO_FEE, submitTransfer } from "./transfer";

const messageMock = vi.fn();
const connectMock = vi.fn<(config: unknown) => { message: typeof messageMock }>(() => ({
  message: messageMock,
}));
const createDataItemSignerMock = vi.fn((jwk: unknown) => ({ __signerFor: jwk }));

vi.mock("@permaweb/aoconnect", () => ({
  connect: (arg: unknown) => connectMock(arg),
  createDataItemSigner: (arg: unknown) => createDataItemSignerMock(arg),
}));

const PROCESS_ID = "processABC";
const RECIPIENT = "recipientXYZ";
const PEER = "https://hyperbeam.example.com";
const JWK = { kty: "RSA", n: "fake-n", e: "AQAB" } as unknown as Parameters<typeof submitTransfer>[1];

beforeEach(() => {
  connectMock.mockClear();
  messageMock.mockReset();
  createDataItemSignerMock.mockClear();
});

describe("AO submitTransfer", () => {
  it("connects in mainnet mode against the given HyperBEAM peer, process@1.0 device", async () => {
    messageMock.mockResolvedValue("msg-id-1");
    await submitTransfer(PEER, JWK, PROCESS_ID, RECIPIENT, "1000000000000");

    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({ MODE: "mainnet", URL: PEER, device: "process@1.0" }),
    );
  });

  it("signs with createDataItemSigner using the already-decrypted jwk", async () => {
    messageMock.mockResolvedValue("msg-id-1");
    await submitTransfer(PEER, JWK, PROCESS_ID, RECIPIENT, "1000000000000");

    expect(createDataItemSignerMock).toHaveBeenCalledWith(JWK);
  });

  it("registers that signer on the mainnet client, which is what aoconnect signs the data item and request with", async () => {
    messageMock.mockResolvedValue("msg-id-1");
    await submitTransfer(PEER, JWK, PROCESS_ID, RECIPIENT, "1000000000000");

    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({ signer: { __signerFor: JWK } }),
    );
  });

  it("requests the message id explicitly, because mainnet message() resolves with the slot by default", async () => {
    messageMock.mockResolvedValue("msg-id-1");
    await submitTransfer(PEER, JWK, PROCESS_ID, RECIPIENT, "1000000000000");

    expect(messageMock).toHaveBeenCalledWith(
      expect.objectContaining({ returnMessageId: true }),
    );
  });

  it("posts a Transfer message with Action/Recipient/Quantity tags to the token process", async () => {
    messageMock.mockResolvedValue("msg-id-1");
    await submitTransfer(PEER, JWK, PROCESS_ID, RECIPIENT, "42");

    expect(messageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        process: PROCESS_ID,
        tags: [
          { name: "Action", value: "Transfer" },
          { name: "Recipient", value: RECIPIENT },
          { name: "Quantity", value: "42" },
        ],
      }),
    );
  });

  it("returns the messageId aoconnect's message() resolves with", async () => {
    messageMock.mockResolvedValue("msg-id-42");
    const result = await submitTransfer(PEER, JWK, PROCESS_ID, RECIPIENT, "42");
    expect(result).toEqual({ messageId: "msg-id-42" });
  });

  it("preserves large atomic-integer amounts exactly as strings, never floats", async () => {
    messageMock.mockResolvedValue("msg-id-1");
    const huge = "90071992547409930000";
    await submitTransfer(PEER, JWK, PROCESS_ID, RECIPIENT, huge);

    const call = messageMock.mock.calls[0]?.[0] as { tags: Array<{ name: string; value: string }> };
    const quantityTag = call.tags.find((tag) => tag.name === "Quantity");
    expect(quantityTag?.value).toBe(huge);
    expect(typeof quantityTag?.value).toBe("string");
  });

  it("throws a descriptive error if aoconnect's message() returns a non-string result", async () => {
    messageMock.mockResolvedValue({ slot: "1", id: "msg-id-1" });
    await expect(
      submitTransfer(PEER, JWK, PROCESS_ID, RECIPIENT, "1"),
    ).rejects.toThrow(/Unexpected aoconnect message\(\) result/);
  });

  it("propagates a rejection from aoconnect's message() (e.g. MU unreachable)", async () => {
    messageMock.mockRejectedValue(new Error("network error"));
    await expect(
      submitTransfer(PEER, JWK, PROCESS_ID, RECIPIENT, "1"),
    ).rejects.toThrow(/network error/);
  });
});

describe("AO_TRANSFER_HAS_NO_FEE", () => {
  it("is explicit that AO transfers have no sender-side fee quote, unlike AR", () => {
    expect(AO_TRANSFER_HAS_NO_FEE).toBe(true);
  });
});
