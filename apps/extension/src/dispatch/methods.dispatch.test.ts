import { describe, expect, it } from "vitest";
import { APPROVAL_METHODS, KEY_METHODS, PROVIDER_METHODS } from "@gleam/core";
import { APPROVAL_GATED_METHODS } from "@gleam/messaging/src/page-protocol.ts";
import { BACKGROUND_MESSAGES, PAGE_METHODS, parseParams } from "./methods";

const PROCESS_ID = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";

describe("dispatch/methods: tiers", () => {
  it("lists exactly the provider methods as page methods", () => {
    expect(Object.keys(PAGE_METHODS).sort()).toEqual([...PROVIDER_METHODS].sort());
  });

  it("marks as approval methods exactly those the page waits the approval timeout for", () => {
    const approval = Object.entries(PAGE_METHODS)
      .filter(([, spec]) => spec.approval)
      .map(([method]) => method);
    expect(approval.sort()).toEqual([...APPROVAL_GATED_METHODS].sort());
  });

  it("lets only connect and disconnect run without a grant", () => {
    const ungranted = Object.entries(PAGE_METHODS)
      .filter(([, spec]) => !spec.grant)
      .map(([method]) => method);
    expect(ungranted.sort()).toEqual(["connect", "disconnect"]);
  });

  it("opens only the three tab-scoped messages to content scripts", () => {
    const contentScript = Object.entries(BACKGROUND_MESSAGES)
      .filter(([, spec]) => spec.tier === "contentScript")
      .map(([method]) => method);
    expect(contentScript.sort()).toEqual(["getSiteWalletMode", "providerCall", "reportOtherWallet"]);
  });

  it("keeps key and approval methods on the extension tier", () => {
    for (const method of [...KEY_METHODS, ...APPROVAL_METHODS]) {
      expect(BACKGROUND_MESSAGES[method].tier, method).toBe("extension");
    }
  });
});

describe("dispatch/methods: page params", () => {
  it("fails with the reader's own message", () => {
    expect(() => parseParams(PAGE_METHODS.sign.params, {})).toThrow("sign requires a transaction.");
    expect(() => parseParams(PAGE_METHODS.tokenBalance.params, { id: "nope" })).toThrow(
      "tokenBalance: id must be an AO process id (43 base64url characters).",
    );
  });

  it("reports the first failing param in declaration order", () => {
    expect(() => parseParams(PAGE_METHODS.encrypt.params, { data: 5, options: "x" })).toThrow(
      '"data" must be an ArrayBuffer or Uint8Array.',
    );
  });

  it("requires every transferAoTokens field as a non-empty string", () => {
    const valid = { token: PROCESS_ID, recipient: PROCESS_ID, amount: "1000" };
    expect(parseParams(PAGE_METHODS.transferAoTokens.params, valid)).toEqual(valid);
    for (const broken of [{ ...valid, amount: "" }, { ...valid, recipient: 42 }, { token: PROCESS_ID }]) {
      expect(() => parseParams(PAGE_METHODS.transferAoTokens.params, broken)).toThrow(
        "transferAoTokens requires token, recipient, and amount.",
      );
    }
  });

  it("drops keys a method doesn't take", () => {
    expect(parseParams(PAGE_METHODS.getPermissions.params, { extra: true })).toEqual({});
    expect(parseParams(PAGE_METHODS.tokenBalance.params, { id: PROCESS_ID, extra: true })).toEqual({ id: PROCESS_ID });
  });

  it("defaults connect to the address permission and drops unknown names", () => {
    expect(parseParams(PAGE_METHODS.connect.params, {})).toEqual({ permissions: ["ACCESS_ADDRESS"], appInfo: null });
    expect(
      parseParams(PAGE_METHODS.connect.params, { permissions: ["SIGNATURE", "STEAL_KEYS", 7] }).permissions,
    ).toEqual(["SIGNATURE"]);
  });

  it("keeps only connect's string appInfo fields, trimmed and capped", () => {
    const { appInfo } = parseParams(PAGE_METHODS.connect.params, {
      appInfo: { name: `  ${"n".repeat(80)}  `, logo: 5 },
    });
    expect(appInfo).toEqual({ name: "n".repeat(64), logo: null });
  });

  it("rejects a non-string verifyMessage publicKey and accepts a missing one", () => {
    const base = { data: new Uint8Array([1]), signature: new Uint8Array([2]) };
    expect(() => parseParams(PAGE_METHODS.verifyMessage.params, { ...base, publicKey: 5 })).toThrow(
      "verifyMessage publicKey must be a string.",
    );
    expect(parseParams(PAGE_METHODS.verifyMessage.params, base).publicKey).toBeUndefined();
  });

  it("reads userTokens' fetchBalance only when it is exactly true", () => {
    expect(parseParams(PAGE_METHODS.userTokens.params, {}).options).toEqual({ fetchBalance: false });
    expect(parseParams(PAGE_METHODS.userTokens.params, { options: { fetchBalance: "yes" } }).options).toEqual({
      fetchBalance: false,
    });
    expect(parseParams(PAGE_METHODS.userTokens.params, { options: { fetchBalance: true } }).options).toEqual({
      fetchBalance: true,
    });
  });
});

describe("dispatch/methods: content-script params", () => {
  it("rejects a malformed reportOtherWallet", () => {
    expect(() => parseParams(BACKGROUND_MESSAGES.reportOtherWallet.params, { walletName: 1, used: true })).toThrow(
      "reportOtherWallet needs a walletName.",
    );
    expect(() => parseParams(BACKGROUND_MESSAGES.reportOtherWallet.params, { walletName: "Wander" })).toThrow(
      "reportOtherWallet needs a boolean used.",
    );
  });

  it("accepts a provider call with no params key", () => {
    expect(parseParams(BACKGROUND_MESSAGES.providerCall.params, { method: "getPermissions" })).toEqual({
      method: "getPermissions",
    });
  });

  it("needs a string method on a provider call", () => {
    expect(() => parseParams(BACKGROUND_MESSAGES.providerCall.params, { method: 3, params: {} })).toThrow(
      "A provider call needs a method name.",
    );
  });
});

describe("dispatch/methods: Gleam Points refusals", () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const b64url = (text: string) => Buffer.from(text).toString("base64url");
  const POINTS_MESSAGE = "gleam-points:leave:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1700000000";

  it.each([undefined, "SHA-256", "SHA-384", "SHA-512"])(
    "refuses a signMessage whose data starts with the points prefix (hashAlgorithm %s)",
    (hashAlgorithm) => {
      const options = hashAlgorithm === undefined ? undefined : { hashAlgorithm };
      expect(() => parseParams(PAGE_METHODS.signMessage.params, { data: encode(POINTS_MESSAGE), options })).toThrow(
        "Gleam refused this request because Gleam Points messages can only be signed from Gleam itself.",
      );
    },
  );

  it("refuses the prefix at byte 0 of a view into a larger buffer, and in a bare ArrayBuffer", () => {
    const points = encode(POINTS_MESSAGE);
    const parent = new Uint8Array(points.byteLength + 5);
    parent.set([1, 2, 3, 4, 5]);
    parent.set(points, 5);
    const view = parent.subarray(5);
    expect(view.byteOffset).toBe(5);

    for (const data of [view, points.slice().buffer]) {
      expect(() => parseParams(PAGE_METHODS.signMessage.params, { data })).toThrow(
        "Gleam refused this request because Gleam Points messages can only be signed from Gleam itself.",
      );
    }
  });

  it("refuses a sign tag name with a UTF-8 BOM before Gleam-Points", () => {
    const transaction = { tags: [{ name: b64url("\uFEFFGleam-Points"), value: b64url(POINTS_MESSAGE) }] };
    expect(() => parseParams(PAGE_METHODS.sign.params, { transaction })).toThrow(
      "Gleam refused this transaction because a Gleam-Points tag can only be signed from Gleam itself.",
    );
  });

  it("accepts a signMessage that only contains the prefix after byte 0", () => {
    const data = encode(`Sign in to example.com. ${POINTS_MESSAGE}`);
    expect(Array.from(parseParams(PAGE_METHODS.signMessage.params, { data }).data)).toEqual(Array.from(data));
  });

  it.each(["sign", "dispatch"] as const)("refuses a %s transaction carrying a Gleam-Points tag", (method) => {
    for (const name of ["Gleam-Points", "gleam-points"]) {
      const transaction = {
        tags: [
          { name: b64url("App-Name"), value: b64url("x") },
          { name: b64url(name), value: b64url(POINTS_MESSAGE) },
        ],
      };
      expect(() => parseParams(PAGE_METHODS[method].params, { transaction })).toThrow(
        "Gleam refused this transaction because a Gleam-Points tag can only be signed from Gleam itself.",
      );
    }
  });

  it.each(["sign", "dispatch"] as const)("accepts a %s transaction whose other tags hold a points message", (method) => {
    const transaction = { tags: [{ name: b64url("Note"), value: b64url(POINTS_MESSAGE) }] };
    expect(parseParams(PAGE_METHODS[method].params, { transaction }).transaction.tags).toEqual([
      { name: "Note", value: POINTS_MESSAGE },
    ]);
  });
});
