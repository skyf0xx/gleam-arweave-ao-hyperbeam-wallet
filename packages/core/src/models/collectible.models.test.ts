import { describe, expect, it } from "vitest";
import { collectibleSendRefusal } from "./collectible";

const SENDER = "sEnDeR_AdDrEsS-0123456789abcdefghijklmnopqr";
const RECIPIENT = "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno";
const ASSET = "aSsEt_PrOcEsS-0123456789abcdefghijklmnopqrs";

describe("collectibleSendRefusal", () => {
  it("allows a send to another wallet", () => {
    expect(collectibleSendRefusal({ sender: SENDER, recipient: RECIPIENT, assetId: ASSET })).toBeNull();
  });

  it("refuses the sender's own address", () => {
    expect(collectibleSendRefusal({ sender: SENDER, recipient: SENDER, assetId: ASSET })).toMatch(/this wallet's own address/);
  });

  it("refuses the collectible's own process id", () => {
    expect(collectibleSendRefusal({ sender: SENDER, recipient: ASSET, assetId: ASSET })).toBe(
      "That's the collectible's own address. Enter the recipient's wallet address.",
    );
  });

  it("refuses a malformed recipient or asset id", () => {
    expect(collectibleSendRefusal({ sender: SENDER, recipient: "short", assetId: ASSET })).toMatch(/full Arweave address/);
    expect(collectibleSendRefusal({ sender: SENDER, recipient: RECIPIENT, assetId: "bad id" })).toMatch(/valid Arweave id/);
  });
});
