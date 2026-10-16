import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SITE = join(__dirname, "../apps/site");

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

  for (const page of readdirSync(SITE).filter((file) => file.endsWith(".html"))) {
    it(`allows every inline script in ${page}`, () => {
      const html = readFileSync(join(SITE, page), "utf8");
      for (const [, body] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        const hash = `'sha256-${createHash("sha256").update(body!).digest("base64")}'`;
        expect(scriptSrc, `add ${hash} to script-src in apps/site/vercel.json`).toContain(hash);
      }
    });
  }

  it("never allows inline event handlers", () => {
    for (const page of readdirSync(SITE).filter((file) => file.endsWith(".html"))) {
      expect(readFileSync(join(SITE, page), "utf8")).not.toMatch(/\son[a-z]+="/);
    }
  });
});
