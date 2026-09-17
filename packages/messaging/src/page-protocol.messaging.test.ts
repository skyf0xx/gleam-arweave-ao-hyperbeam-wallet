import { describe, expect, it } from "vitest";
import {
  EVENT,
  PROVIDER_EVENT,
  PROVIDER_SURFACE_METHODS,
  REQUEST,
  RESPONSE,
  type ConnectEventPayload,
  type DisconnectEventPayload,
  type PageEventEnvelope,
  type PageMessageEnvelope,
  type ProviderEventMap,
  type ProviderEventName,
  type WalletSwitchEventPayload,
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

  it("a transferAoTokens request envelope carries the AO transfer params, following the same envelope shape as every other provider method", () => {
    const envelope: PageMessageEnvelope = {
      type: REQUEST,
      id: "11111111-1111-1111-1111-111111111111",
      method: "transferAoTokens",
      params: { token: "ao-process-id", recipient: "abc", amount: "1000" },
    };
    expect(envelope.type).toBe(REQUEST);
    expect(envelope.method).toBe("transferAoTokens");
  });

  it("a transferAoTokens response envelope carries an id, mirroring dispatch()'s response shape", () => {
    const success: PageMessageEnvelope = {
      type: RESPONSE,
      id: "11111111-1111-1111-1111-111111111111",
      result: { id: "message-id-1" },
    };
    expect(success.type).toBe(RESPONSE);
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

describe("PROVIDER_EVENT", () => {
  it("matches Wander's arweaveWalletLoaded/walletSwitch naming convention for connect/disconnect/walletSwitch", () => {
    expect(PROVIDER_EVENT.CONNECT).toBe("connect");
    expect(PROVIDER_EVENT.DISCONNECT).toBe("disconnect");
    expect(PROVIDER_EVENT.WALLET_SWITCH).toBe("walletSwitch");
  });

  it("every PROVIDER_EVENT value is a distinct ProviderEventName", () => {
    const names: ProviderEventName[] = [
      PROVIDER_EVENT.CONNECT,
      PROVIDER_EVENT.DISCONNECT,
      PROVIDER_EVENT.WALLET_SWITCH,
    ];
    expect(new Set(names).size).toBe(3);
  });
});

describe("ProviderEventMap payload shapes", () => {
  it("a connect event carries the newly active address", () => {
    const payload: ProviderEventMap[typeof PROVIDER_EVENT.CONNECT] = {
      activeAddress: "abc",
    };
    const asConnectEventPayload: ConnectEventPayload = payload;
    expect(asConnectEventPayload.activeAddress).toBe("abc");
  });

  it("a disconnect event carries no payload fields", () => {
    const payload: ProviderEventMap[typeof PROVIDER_EVENT.DISCONNECT] = {};
    const asDisconnectEventPayload: DisconnectEventPayload = payload;
    expect(Object.keys(asDisconnectEventPayload)).toHaveLength(0);
  });

  it("a walletSwitch event carries the newly active address, matching Wander's { address } shape", () => {
    const payload: ProviderEventMap[typeof PROVIDER_EVENT.WALLET_SWITCH] = {
      address: "xyz",
    };
    const asWalletSwitchEventPayload: WalletSwitchEventPayload = payload;
    expect(asWalletSwitchEventPayload.address).toBe("xyz");
  });

  it("a real PageEventEnvelope can carry any ProviderEventMap payload for its named event", () => {
    const connectEnvelope: PageEventEnvelope = {
      type: EVENT,
      event: PROVIDER_EVENT.CONNECT,
      data: { activeAddress: "abc" } satisfies ProviderEventMap[typeof PROVIDER_EVENT.CONNECT],
    };
    const walletSwitchEnvelope: PageEventEnvelope = {
      type: EVENT,
      event: PROVIDER_EVENT.WALLET_SWITCH,
      data: { address: "xyz" } satisfies ProviderEventMap[typeof PROVIDER_EVENT.WALLET_SWITCH],
    };
    expect(connectEnvelope.event).toBe("connect");
    expect(walletSwitchEnvelope.event).toBe("walletSwitch");
  });
});
