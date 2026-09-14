import { describe, expect, it } from "vitest";
import {
  EVENT,
  PROVIDER_SURFACE_METHODS,
  REQUEST,
  RESPONSE,
  type PageMessageEnvelope,
} from "./page-protocol";
import { KEY_METHODS, PROVIDER_METHODS } from "@gleam/core";

describe("page ↔ content envelope constants", () => {
  it("REQUEST, RESPONSE, and EVENT are distinct string tags", () => {
    const tags = [REQUEST, RESPONSE, EVENT];
    expect(new Set(tags).size).toBe(3);
  });

  it("match the exact strings ARCHITECTURE.md §4.3 specifies", () => {
    expect(REQUEST).toBe("GLEAM_API_CALL");
    expect(RESPONSE).toBe("GLEAM_API_RESPONSE");
    expect(EVENT).toBe("GLEAM_EVENT");
  });
});

describe("PROVIDER_SURFACE_METHODS", () => {
  it("matches PROVIDER_METHODS from core's privilege tiers exactly", () => {
    expect([...PROVIDER_SURFACE_METHODS].sort()).toEqual(
      [...PROVIDER_METHODS].sort(),
    );
  });

  it("never includes a KEY_METHODS name — a page must never reach key management", () => {
    for (const method of KEY_METHODS) {
      expect(PROVIDER_SURFACE_METHODS as readonly string[]).not.toContain(method);
    }
  });
});

describe("PageMessageEnvelope", () => {
  it("a request envelope carries a method from the provider surface", () => {
    const envelope: PageMessageEnvelope = {
      type: REQUEST,
      id: "11111111-1111-1111-1111-111111111111",
      method: "connect",
      params: { permissions: ["ACCESS_ADDRESS"] },
    };
    expect(envelope.type).toBe(REQUEST);
  });

  it("a response envelope matches by id and carries either a result or an error", () => {
    const success: PageMessageEnvelope = {
      type: RESPONSE,
      id: "11111111-1111-1111-1111-111111111111",
      result: { address: "abc" },
    };
    const failure: PageMessageEnvelope = {
      type: RESPONSE,
      id: "11111111-1111-1111-1111-111111111111",
      error: { message: "User rejected the request" },
    };
    expect(success.type).toBe(RESPONSE);
    expect(failure.type).toBe(RESPONSE);
  });

  it("an event envelope carries an event name and payload", () => {
    const envelope: PageMessageEnvelope = {
      type: EVENT,
      event: "walletSwitch",
      data: { address: "abc" },
    };
    expect(envelope.type).toBe(EVENT);
  });
});
