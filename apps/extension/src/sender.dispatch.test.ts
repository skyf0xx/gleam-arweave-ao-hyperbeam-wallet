import { describe, expect, it } from "vitest";
import {
  callerContext,
  contentScriptOrigin,
  externalCallerContext,
  isExtensionPageSender,
  isSecureSigningOrigin,
} from "./sender";

const BASE = "chrome-extension://gleamid/";

describe("isExtensionPageSender", () => {
  it("accepts this extension's own pages", () => {
    expect(isExtensionPageSender({ url: `${BASE}popup.html` }, BASE)).toBe(true);
    expect(isExtensionPageSender({ url: `${BASE}approval.html?id=1`, tab: { id: 3 } }, BASE)).toBe(true);
  });

  it("rejects content scripts, other extensions and senders with no URL", () => {
    expect(isExtensionPageSender({ url: "https://evil.example/", tab: { id: 1 }, frameId: 0 }, BASE)).toBe(false);
    expect(isExtensionPageSender({ url: "chrome-extension://otherid/popup.html" }, BASE)).toBe(false);
    expect(isExtensionPageSender({}, BASE)).toBe(false);
    expect(isExtensionPageSender(undefined, BASE)).toBe(false);
  });
});

describe("contentScriptOrigin", () => {
  const tab = { id: 7, url: "https://dapp.example/app" };

  it("returns the sending frame's origin", () => {
    expect(contentScriptOrigin({ url: "https://dapp.example/app?x=1", tab, frameId: 0 }, BASE)).toBe(
      "https://dapp.example",
    );
    expect(
      contentScriptOrigin({ url: "http://localhost:3000/", origin: "http://localhost:3000", tab, frameId: 0 }, BASE),
    ).toBe("http://localhost:3000");
  });

  it("rejects senders that are not a top-frame content script on an http(s) page", () => {
    expect(contentScriptOrigin({ url: `${BASE}popup.html` }, BASE)).toBeNull();
    expect(contentScriptOrigin({ url: `${BASE}approval.html`, tab: { id: 3 }, frameId: 0 }, BASE)).toBeNull();
    expect(contentScriptOrigin({ url: "https://dapp.example/" }, BASE)).toBeNull();
    expect(contentScriptOrigin({ url: "https://frame.example/", tab, frameId: 4 }, BASE)).toBeNull();
    expect(contentScriptOrigin({ url: "file:///tmp/x.html", tab, frameId: 0 }, BASE)).toBeNull();
    expect(contentScriptOrigin({ url: "not a url", tab, frameId: 0 }, BASE)).toBeNull();
    expect(contentScriptOrigin(undefined, BASE)).toBeNull();
  });

  it("rejects a document whose real origin differs from its URL, such as a sandboxed page", () => {
    expect(contentScriptOrigin({ url: "https://dapp.example/", origin: "null", tab, frameId: 0 }, BASE)).toBeNull();
  });
});

describe("callerContext", () => {
  const tab = { id: 7, url: "https://dapp.example/app" };

  it("gives this extension's own pages the extension tier, with no origin", () => {
    expect(callerContext({ url: `${BASE}popup.html` }, BASE)).toEqual({ tier: "extension" });
    expect(callerContext({ url: `${BASE}approval.html?id=1`, frameId: 0, tab: { id: 3 } }, BASE)).toEqual({
      tier: "extension",
    });
  });

  it("gives a top-frame content script the content-script tier, with Chrome's origin and tab", () => {
    expect(callerContext({ url: "https://dapp.example/app?x=1", tab, frameId: 0 }, BASE)).toEqual({
      tier: "contentScript",
      origin: "https://dapp.example",
      tabId: 7,
    });
    expect(callerContext({ url: "https://dapp.example/", tab: {}, frameId: 0 }, BASE)).toEqual({
      tier: "contentScript",
      origin: "https://dapp.example",
      tabId: undefined,
    });
  });

  it.each<[string, Parameters<typeof callerContext>[0]]>([
    ["no sender", undefined],
    ["a sender with no URL", {}],
    ["another extension's page", { url: "chrome-extension://otherid/popup.html" }],
    ["a page sender with no tab", { url: "https://dapp.example/" }],
    ["a sub-frame", { url: "https://frame.example/", tab, frameId: 4 }],
    ["a non-http(s) page", { url: "file:///tmp/x.html", tab, frameId: 0 }],
    ["a sandboxed page with an opaque origin", { url: "https://dapp.example/", origin: "null", tab, frameId: 0 }],
  ])("gives %s no context", (_label, sender) => {
    expect(callerContext(sender, BASE)).toBeNull();
  });
});

describe("externalCallerContext", () => {
  it("gives an external sender the site tier with Chrome's origin, whatever that origin is", () => {
    expect(externalCallerContext({ origin: "https://gleam.example", url: "https://gleam.example/welcome.html" })).toEqual({
      tier: "site",
      origin: "https://gleam.example",
    });
    expect(externalCallerContext({ origin: "https://evil.example" })).toEqual({ tier: "site", origin: "https://evil.example" });
  });

  it("gives a sender with no origin no context", () => {
    expect(externalCallerContext(undefined)).toBeNull();
    expect(externalCallerContext({ url: "https://gleam.example/" })).toBeNull();
  });
});

describe("isSecureSigningOrigin", () => {
  it.each([
    "https://dapp.example",
    "https://dapp.example:8443",
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:5173",
    "http://[::1]",
    "http://[::1]:8080",
  ])("accepts %s", (origin) => {
    expect(isSecureSigningOrigin(origin)).toBe(true);
  });

  it.each([
    "http://dapp.example",
    "http://dapp.example:3000",
    "http://localhost.evil.example",
    "http://127.0.0.1.evil.example",
    "http://127.0.0.2",
    "http://0.0.0.0:3000",
    "http://192.168.1.10",
    "ftp://dapp.example",
    "null",
    "",
  ])("refuses %s", (origin) => {
    expect(isSecureSigningOrigin(origin)).toBe(false);
  });
});
