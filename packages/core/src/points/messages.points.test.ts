import { describe, expect, it } from "vitest";
import {
  buildAttestMessage,
  parseAttestMessage,
  buildDeviceMessage,
  buildLeaveMessage,
  parseLeaveMessage,
  buildRedeemMessage,
  parseRedeemMessage,
  buildRegisterMessage,
  isFreshIssuedAt,
  isPointsMessage,
  isValidInviteCode,
  normalizeInviteCode,
  parseDeviceMessage,
  parseRegisterMessage,
} from "./messages";

const THUMBPRINT = "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs";

describe("register message", () => {
  it("round-trips with an invite code", () => {
    const message = { deviceKeyThumbprint: THUMBPRINT, inviteCode: "GLEAM42", issuedAt: 1_760_000_000 };
    const text = buildRegisterMessage(message);

    expect(text).toBe(`gleam-points:register:v1:${THUMBPRINT}:GLEAM42:1760000000`);
    expect(parseRegisterMessage(text)).toEqual(message);
  });

  it("encodes a missing invite code as '-'", () => {
    const text = buildRegisterMessage({ deviceKeyThumbprint: THUMBPRINT, inviteCode: null, issuedAt: 1 });

    expect(text).toBe(`gleam-points:register:v1:${THUMBPRINT}:-:1`);
    expect(parseRegisterMessage(text)?.inviteCode).toBeNull();
  });

  it("refuses to build with a malformed invite code or thumbprint", () => {
    expect(() => buildRegisterMessage({ deviceKeyThumbprint: THUMBPRINT, inviteCode: "a:b", issuedAt: 1 })).toThrow();
    expect(() => buildRegisterMessage({ deviceKeyThumbprint: "short", inviteCode: null, issuedAt: 1 })).toThrow();
  });

  it.each([
    ["another kind", `gleam-points:heartbeat:v1:${THUMBPRINT}:-:1`],
    ["another version", `gleam-points:register:v2:${THUMBPRINT}:-:1`],
    ["an extra field", `gleam-points:register:v1:${THUMBPRINT}:-:1:x`],
    ["a non-numeric timestamp", `gleam-points:register:v1:${THUMBPRINT}:-:1e9`],
    ["a lowercase invite code", `gleam-points:register:v1:${THUMBPRINT}:gleam42:1`],
  ])("rejects %s", (_label, text) => {
    expect(parseRegisterMessage(text)).toBeNull();
  });
});

describe("leave message", () => {
  const ADDRESS = "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx1234";

  it("round-trips", () => {
    const text = buildLeaveMessage(ADDRESS, 1_760_000_000);

    expect(text).toBe(`gleam-points:leave:v1:${ADDRESS}:1760000000`);
    expect(parseLeaveMessage(text)).toEqual({ address: ADDRESS, issuedAt: 1_760_000_000 });
  });

  it("rejects another kind, a bad address and a malformed timestamp", () => {
    expect(parseLeaveMessage(`gleam-points:heartbeat:v1:${ADDRESS}:1`)).toBeNull();
    expect(parseLeaveMessage("gleam-points:leave:v1:short:1")).toBeNull();
    expect(parseLeaveMessage(`gleam-points:leave:v1:${ADDRESS}:x`)).toBeNull();
    expect(() => buildLeaveMessage("short", 1)).toThrow();
  });
});

describe("redeem message", () => {
  it("round-trips", () => {
    const text = buildRedeemMessage("GLEAMDROP7", 1_760_000_000);

    expect(text).toBe("gleam-points:redeem:v1:GLEAMDROP7:1760000000");
    expect(parseRedeemMessage(text)).toEqual({ code: "GLEAMDROP7", issuedAt: 1_760_000_000 });
  });

  it("refuses to build with a malformed code", () => {
    expect(() => buildRedeemMessage("gleam", 1)).toThrow();
    expect(() => buildRedeemMessage("A:B:CDEF", 1)).toThrow();
  });

  it.each([
    ["another kind", "gleam-points:leave:v1:GLEAMDROP7:1"],
    ["another version", "gleam-points:redeem:v2:GLEAMDROP7:1"],
    ["a lowercase code", "gleam-points:redeem:v1:gleamdrop7:1"],
    ["a missing code", "gleam-points:redeem:v1:1"],
    ["a non-numeric timestamp", "gleam-points:redeem:v1:GLEAMDROP7:x"],
  ])("rejects %s", (_label, text) => {
    expect(parseRedeemMessage(text)).toBeNull();
  });
});

describe("device messages", () => {
  it("round-trips a heartbeat", () => {
    const text = buildDeviceMessage("heartbeat", 1_760_000_000);

    expect(text).toBe("gleam-points:heartbeat:v1:1760000000");
    expect(parseDeviceMessage("heartbeat", text)).toBe(1_760_000_000);
  });

  it("won't accept a heartbeat as a score read", () => {
    expect(parseDeviceMessage("me", buildDeviceMessage("heartbeat", 5))).toBeNull();
  });

  it("refuses a fractional or negative timestamp", () => {
    expect(() => buildDeviceMessage("me", 1.5)).toThrow();
    expect(() => buildDeviceMessage("me", -1)).toThrow();
  });
});

describe("attest message", () => {
  const ID = "3f".repeat(32);

  it("round-trips", () => {
    const text = buildAttestMessage("1.4.0", ID);

    expect(text).toBe(`gleam-points:attest:v1:1.4.0:${ID}`);
    expect(parseAttestMessage(text)).toEqual({ release: "1.4.0", attestationId: ID });
  });

  it("refuses to build with a malformed release or id", () => {
    expect(() => buildAttestMessage("1.4", ID)).toThrow();
    expect(() => buildAttestMessage("1.4.0:x", ID)).toThrow();
    expect(() => buildAttestMessage("1.4.0", ID.toUpperCase())).toThrow();
    expect(() => buildAttestMessage("1.4.0", ID.slice(1))).toThrow();
  });

  it.each([
    ["another kind", `gleam-points:leave:v1:1.4.0:${ID}`],
    ["another version", `gleam-points:attest:v2:1.4.0:${ID}`],
    ["a pre-release", `gleam-points:attest:v1:1.4.0-rc.1:${ID}`],
    ["an uppercase id", `gleam-points:attest:v1:1.4.0:${ID.toUpperCase()}`],
    ["an extra field", `gleam-points:attest:v1:1.4.0:${ID}:1`],
    ["a missing id", "gleam-points:attest:v1:1.4.0"],
  ])("rejects %s", (_label, text) => {
    expect(parseAttestMessage(text)).toBeNull();
  });

  it("is refused as a dApp signMessage payload", () => {
    expect(isPointsMessage(new TextEncoder().encode(buildAttestMessage("1.4.0", ID)))).toBe(true);
  });
});

describe("isFreshIssuedAt", () => {
  const now = 1_760_000_000;

  it("accepts up to ten minutes old and a minute of future skew", () => {
    expect(isFreshIssuedAt(now - 600, now)).toBe(true);
    expect(isFreshIssuedAt(now + 60, now)).toBe(true);
  });

  it("rejects anything older or further ahead", () => {
    expect(isFreshIssuedAt(now - 601, now)).toBe(false);
    expect(isFreshIssuedAt(now + 61, now)).toBe(false);
  });
});

describe("invite codes", () => {
  it("normalizes hand-typed input before validating", () => {
    expect(normalizeInviteCode("  gleam42 ")).toBe("GLEAM42");
    expect(isValidInviteCode("GLEAM42")).toBe(true);
    expect(isValidInviteCode("GL")).toBe(false);
  });
});

describe("isPointsMessage", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it("flags every payload Gleam Points builds", () => {
    for (const text of [
      buildRegisterMessage({ deviceKeyThumbprint: THUMBPRINT, inviteCode: null, issuedAt: 1 }),
      buildLeaveMessage(THUMBPRINT, 1),
      buildRedeemMessage("GLEAM42", 1),
      buildDeviceMessage("heartbeat", 1),
      "gleam-points:attest:v1:1.2.3:abc",
    ]) {
      expect(isPointsMessage(encode(text))).toBe(true);
    }
  });

  it("flags the bare prefix, even when the rest isn't UTF-8", () => {
    expect(isPointsMessage(encode("gleam-points:"))).toBe(true);
    expect(isPointsMessage(new Uint8Array([...encode("gleam-points:"), 0xff, 0xfe]))).toBe(true);
  });

  it("only matches the prefix at byte 0", () => {
    expect(isPointsMessage(encode(" gleam-points:leave:v1"))).toBe(false);
    expect(isPointsMessage(encode("hello gleam-points:leave:v1"))).toBe(false);
    expect(isPointsMessage(encode("gleam-points"))).toBe(false);
    expect(isPointsMessage(encode("Gleam-Points:leave:v1"))).toBe(false);
    expect(isPointsMessage(new Uint8Array())).toBe(false);
  });
});
