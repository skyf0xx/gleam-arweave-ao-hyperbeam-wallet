import { describe, expect, it } from "vitest";
import { addressParts } from "./address-parts";

describe("addressParts", () => {
  it("splits a URL into scheme, subdomain, site, path, query and fragment", () => {
    expect(addressParts("https://app.permaswap.network/swap/AR-USDC?ref=8f3k2c&slippage=0.5#confirm")).toEqual({
      scheme: "https://",
      subdomain: "app",
      site: "permaswap.network",
      port: "",
      path: ["swap", "AR-USDC"],
      query: [
        { key: "ref", value: "8f3k2c" },
        { key: "slippage", value: "0.5" },
      ],
      fragment: "confirm",
      insecure: false,
      href: "https://app.permaswap.network/swap/AR-USDC?ref=8f3k2c&slippage=0.5#confirm",
    });
  });

  it("takes the site from the end of the host, so a lookalike's real site is the one shown", () => {
    const parts = addressParts("https://permaswap.network.wallet-verify.arweave-sso.xyz/connect");
    expect(parts?.site).toBe("arweave-sso.xyz");
    expect(parts?.subdomain).toBe("permaswap.network.wallet-verify");
  });

  it.each([
    ["https://shop.example.co.uk/", "example.co.uk", "shop"],
    ["https://someone.github.io/app", "someone.github.io", ""],
    ["https://arweave.net/", "arweave.net", ""],
  ])("reads %s as the site %s", (url, site, subdomain) => {
    expect(addressParts(url)).toMatchObject({ site, subdomain });
  });

  it.each(["http://localhost:3000/", "http://192.168.1.4/", "http://[::1]:8080/"])("uses the whole host as the site for %s", (url) => {
    const parts = addressParts(url);
    expect(parts?.site).toBe(new URL(url).hostname);
    expect(parts?.subdomain).toBe("");
    expect(parts?.insecure).toBe(true);
  });

  it("keeps the port apart from the site", () => {
    expect(addressParts("https://node.example:8443/")).toMatchObject({ site: "node.example", port: "8443" });
  });

  it("shows an internationalised name in punycode", () => {
    // A Cyrillic "а" in place of the Latin one.
    expect(addressParts("https://аrweave.net/")?.site).toMatch(/^xn--[a-z0-9-]+\.net$/);
  });

  it("decodes path, query and fragment, and drops bidi overrides from them", () => {
    const parts = addressParts("https://a.example/caf%C3%A9/%E2%80%AEtxt?n%C3%A4me=v%E2%80%AEal#x%E2%80%AEy");
    expect(parts?.path).toEqual(["café", "txt"]);
    expect(parts?.query).toEqual([{ key: "näme", value: "val" }]);
    expect(parts?.fragment).toBe("xy");
  });

  it("reads a query key with no value", () => {
    expect(addressParts("https://a.example/?debug&x=1")?.query).toEqual([
      { key: "debug", value: "" },
      { key: "x", value: "1" },
    ]);
  });

  it.each(["javascript:alert(1)", "file:///etc/hosts", "not a url"])("refuses %s", (url) => {
    expect(addressParts(url)).toBeNull();
  });
});
