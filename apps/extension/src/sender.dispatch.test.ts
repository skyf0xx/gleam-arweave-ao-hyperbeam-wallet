import { describe, expect, it } from "vitest";
import { contentScriptOrigin, isExtensionPageSender } from "./sender";

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
