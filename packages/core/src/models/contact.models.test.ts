import { describe, expect, it } from "vitest";
import { isValidArweaveAddress, type Contact } from "./contact";

describe("Contact model shape", () => {
  it("is representable with a trimmed 1-32 character name", () => {
    const contact: Contact = {
      address: "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx1234",
      name: "Alice",
      createdAt: 0,
    };
    expect(contact.name.length).toBeGreaterThan(0);
    expect(contact.name.length).toBeLessThanOrEqual(32);
  });
});

describe("isValidArweaveAddress", () => {
  it("accepts a 43-character base64url address", () => {
    expect(isValidArweaveAddress("aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx1234")).toBe(true);
  });

  it("rejects a too-short or too-long value", () => {
    expect(isValidArweaveAddress("too-short")).toBe(false);
    expect(isValidArweaveAddress("aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx1234extra")).toBe(false);
  });

  it("rejects characters outside base64url", () => {
    expect(isValidArweaveAddress("aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx123!")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidArweaveAddress("")).toBe(false);
  });
});
