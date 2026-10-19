import { describe, expect, it } from "vitest";
import { l1TransferTags, readL1TokenTransfer } from "./l1-transfer";

const PID = "EuEkh8ZYkoPKXimgjre7W268XXX_qRn5vofc66oRTOw";
const RECIPIENT = "R".repeat(43);

describe("readL1TokenTransfer", () => {
  it("reads back exactly what l1TransferTags writes", () => {
    expect(
      readL1TokenTransfer({ target: PID, quantity: "0", data_size: "0", tags: l1TransferTags(RECIPIENT, "311") }),
    ).toEqual({ processId: PID, recipient: RECIPIENT, quantity: "311" });
  });

  it("rejects AR value, data, extra tags and a non-positive quantity", () => {
    const tags = l1TransferTags(RECIPIENT, "5");
    expect(readL1TokenTransfer({ target: PID, quantity: "1", data_size: "0", tags })).toBeNull();
    expect(readL1TokenTransfer({ target: PID, quantity: "0", data_size: "4", tags })).toBeNull();
    expect(readL1TokenTransfer({ target: PID, quantity: "0", data_size: "0", tags: [...tags, { name: "x", value: "y" }] })).toBeNull();
    expect(readL1TokenTransfer({ target: PID, quantity: "0", data_size: "0", tags: l1TransferTags(RECIPIENT, "0") })).toBeNull();
  });
});
