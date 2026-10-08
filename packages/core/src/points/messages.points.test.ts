import { describe, expect, it } from "vitest";
import {
  buildDeviceMessage,
  buildRegisterMessage,
  isFreshIssuedAt,
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
