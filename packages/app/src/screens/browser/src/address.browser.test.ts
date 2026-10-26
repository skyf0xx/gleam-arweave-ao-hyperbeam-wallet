import { describe, expect, it } from "vitest";
import { BUILT_IN_SITES, knownSite, matchSites, parseAddress, resolveInput, siteHost, type KnownSite } from "./address";

const SITES = [
  "https://my.example/",
  ...BUILT_IN_SITES,
  "https://recent.example",
].map((url) => knownSite(url) as KnownSite);

describe("parseAddress", () => {
  it("keeps an http(s) URL as typed", () => {
    expect(parseAddress("https://bazar.arweave.net/#/path")).toBe("https://bazar.arweave.net/#/path");
    expect(parseAddress("  http://example.com  ")).toBe("http://example.com/");
  });

  it("adds https:// to text that looks like a host", () => {
    expect(parseAddress("bazar.arweave.net")).toBe("https://bazar.arweave.net/");
    expect(parseAddress("example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(parseAddress("localhost.test:8080")).toBe("https://localhost.test:8080/");
  });

  it("rejects any other scheme", () => {
    for (const text of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "ftp://example.com", "intent://x.y#Intent;end"]) {
      expect(parseAddress(text)).toBeNull();
    }
  });

  it("gives nothing for plain words, spaces and empty text", () => {
    for (const text of ["", "   ", "bazar", "two words.com", "what is ao"]) {
      expect(parseAddress(text)).toBeNull();
    }
  });

  it("gives nothing for a host that can't parse", () => {
    expect(parseAddress("https://")).toBeNull();
    expect(parseAddress("a b.com")).toBeNull();
    expect(parseAddress("https://exa mple.com")).toBeNull();
  });
});

describe("siteHost", () => {
  it("shows the punycode form of an internationalised host", () => {
    expect(siteHost("https://münchen.de/")?.host).toBe("xn--mnchen-3ya.de");
    expect(siteHost("https://аррӏе.com/")?.host).toMatch(/^xn--/);
  });

  it("marks only http: as insecure", () => {
    expect(siteHost("http://example.com")).toEqual({ host: "example.com", insecure: true });
    expect(siteHost("https://example.com")).toEqual({ host: "example.com", insecure: false });
  });

  it("keeps a port and refuses other schemes", () => {
    expect(siteHost("https://example.com:8443/x")?.host).toBe("example.com:8443");
    expect(siteHost("about:blank")).toBeNull();
    expect(siteHost("nonsense")).toBeNull();
  });
});

describe("matchSites", () => {
  it("matches a part of the host, in the order given, ignoring case and scheme", () => {
    expect(matchSites("ARWEAVE", SITES).map((site) => site.host)).toEqual(["bazar.arweave.net", "ao.arweave.net"]);
    expect(matchSites("https://my.", SITES).map((site) => site.host)).toEqual(["my.example"]);
  });

  it("matches nothing for empty text", () => {
    expect(matchSites("  ", SITES)).toEqual([]);
  });
});

describe("resolveInput", () => {
  it("opens text that parses as an address exactly as typed, even when it matches a known site", () => {
    expect(resolveInput("arweave.net", SITES)).toBe("https://arweave.net/");
    expect(resolveInput("ao.arw", SITES)).toBe("https://ao.arw/");
    expect(resolveInput("https://ao.arweave.net/x", SITES)).toBe("https://ao.arweave.net/x");
  });

  it("opens the first known site only for text that isn't an address", () => {
    expect(resolveInput("bazar", SITES)).toBe("https://bazar.arweave.net/");
    expect(resolveInput("recent", SITES)).toBe("https://recent.example");
  });

  it("opens nothing when text is neither", () => {
    expect(resolveInput("nothing here", SITES)).toBeNull();
    expect(resolveInput("javascript:alert(1)", SITES)).toBeNull();
  });
});
