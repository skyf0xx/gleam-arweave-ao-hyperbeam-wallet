import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SITE = join(__dirname, "../apps/site");

// Every page: the home page and each folder's index.html.
const PAGES = ["index.html", ...readdirSync(SITE).filter((dir) => existsSync(join(SITE, dir, "index.html"))).map((dir) => `${dir}/index.html`)];

function contentSecurityPolicy(): string {
  const config = JSON.parse(readFileSync(join(SITE, "vercel.json"), "utf8")) as {
    headers: Array<{ headers: Array<{ key: string; value: string }> }>;
  };
  const header = config.headers.flatMap((rule) => rule.headers).find((h) => h.key === "Content-Security-Policy");
  if (!header) throw new Error("vercel.json sets no Content-Security-Policy");
  return header.value;
}

// The CSP allows the site's inline scripts by hash, so editing one without
// updating vercel.json would silently stop it running.
describe("site CSP", () => {
  const scriptSrc = contentSecurityPolicy().match(/script-src ([^;]+)/)?.[1] ?? "";

  for (const page of PAGES) {
    it(`allows every inline script in ${page}`, () => {
      const html = readFileSync(join(SITE, page), "utf8");
      for (const [, body] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        const hash = `'sha256-${createHash("sha256").update(body!).digest("base64")}'`;
        expect(scriptSrc, `add ${hash} to script-src in apps/site/vercel.json`).toContain(hash);
      }
    });
  }

  // A script host the site doesn't control can swap download links and
  // addresses on every page if it's breached, as Optimizely's CDN was.
  it("allows scripts only from the site itself or by hash", () => {
    for (const source of scriptSrc.trim().split(/\s+/)) {
      expect(source, "serve the script from apps/site instead").toMatch(/^'(self|sha256-[A-Za-z0-9+/=]+)'$/);
    }
  });

  it("loads every script from the site", () => {
    for (const page of PAGES) {
      const html = readFileSync(join(SITE, page), "utf8");
      for (const [, src] of html.matchAll(/<script[^>]*\bsrc="([^"]*)"/gi)) {
        expect(src, `${page} loads a remote script`).not.toMatch(/^(https?:)?\/\//i);
      }
    }
  });

  it("never allows inline event handlers", () => {
    for (const page of PAGES) {
      expect(readFileSync(join(SITE, page), "utf8")).not.toMatch(/\son[a-z]+="/i);
    }
  });
});
