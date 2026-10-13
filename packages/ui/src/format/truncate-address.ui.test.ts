import { describe, expect, it } from "vitest";
import { truncateAddress } from "./truncate-address";

describe("truncateAddress", () => {
  const address = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

  it("keeps 5 leading and 4 trailing characters by default", () => {
    expect(truncateAddress(address)).toBe("abcde…DEFG");
  });

  it("takes custom end lengths", () => {
    expect(truncateAddress(address, 6, 4)).toBe("abcdef…DEFG");
  });

  it("returns short values untouched", () => {
    expect(truncateAddress("abcdefghij")).toBe("abcdefghij");
  });
});
