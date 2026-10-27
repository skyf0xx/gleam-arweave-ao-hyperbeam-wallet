import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => JSON.parse(readFileSync(resolve(__dirname, ".well-known", name), "utf8"));

describe("open.gleamwallet.app association files", () => {
  it("claims exactly the two Points paths for the iOS app id", () => {
    const [detail] = read("apple-app-site-association").applinks.details;
    expect(detail.appIDs).toHaveLength(1);
    expect(detail.appIDs[0]).toMatch(/\.app\.gleamwallet$/);
    expect(detail.components).toEqual([{ "/": "/invite", "?": { code: "?*" } }, { "/": "/attest" }]);
  });

  it("delegates to the Android package", () => {
    const [entry] = read("assetlinks.json");
    expect(entry.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(entry.target.package_name).toBe("app.gleamwallet");
  });
});
