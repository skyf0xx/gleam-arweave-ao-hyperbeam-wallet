import { describe, expect, it, vi } from "vitest";
import { handleInstalledSitePages, sitePageUrl } from "./site-pages";

function deps() {
  return {
    version: "1.2.3",
    openTab: vi.fn().mockResolvedValue(undefined),
    setUninstallUrl: vi.fn().mockResolvedValue(undefined),
  };
}

describe("sitePageUrl", () => {
  it("builds a page URL carrying only the version", () => {
    expect(sitePageUrl("feedback", "1.2.3")).toBe("https://gleam-permaweb.vercel.app/feedback.html?v=1.2.3");
  });
});

describe("handleInstalledSitePages", () => {
  it("opens the welcome page and sets the uninstall URL on first install", async () => {
    const d = deps();
    await handleInstalledSitePages("install", d);

    expect(d.openTab).toHaveBeenCalledWith("https://gleam-permaweb.vercel.app/welcome.html?v=1.2.3");
    expect(d.setUninstallUrl).toHaveBeenCalledWith("https://gleam-permaweb.vercel.app/goodbye.html?v=1.2.3");
  });

  it("refreshes the uninstall URL on update without opening a tab", async () => {
    const d = deps();
    await handleInstalledSitePages("update", d);

    expect(d.openTab).not.toHaveBeenCalled();
    expect(d.setUninstallUrl).toHaveBeenCalledWith("https://gleam-permaweb.vercel.app/goodbye.html?v=1.2.3");
  });
});
