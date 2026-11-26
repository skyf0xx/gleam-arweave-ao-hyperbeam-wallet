import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DAY_MS = 24 * 60 * 60 * 1000;

function securityTxtFields(): Map<string, string[]> {
  const text = readFileSync(resolve(__dirname, ".well-known", "security.txt"), "utf8");
  const fields = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const match = /^([A-Za-z-]+): (\S.*)$/.exec(line);
    expect(match, `malformed line: ${line}`).not.toBeNull();
    const [, name, value] = match!;
    fields.set(name, [...(fields.get(name) ?? []), value]);
  }
  return fields;
}

describe("gleamwallet.app security.txt (RFC 9116)", () => {
  it("has one Expires, at most a year out and at least 30 days away", () => {
    const expires = securityTxtFields().get("Expires") ?? [];
    expect(expires).toHaveLength(1);
    const at = Date.parse(expires[0]);
    expect(Number.isNaN(at)).toBe(false);
    // RFC 9116 asks for less than a year. Failing a month early leaves time to
    // bump the date before scanners start treating the file as stale.
    expect(at - Date.now(), "security.txt expires within 30 days: move Expires on").toBeGreaterThan(30 * DAY_MS);
    expect(at - Date.now()).toBeLessThan(366 * DAY_MS);
  });

  it("names an https contact and the canonical gleamwallet.app URL", () => {
    const fields = securityTxtFields();
    const contacts = fields.get("Contact") ?? [];
    expect(contacts.length).toBeGreaterThan(0);
    for (const c of contacts) expect(c).toMatch(/^https:\/\//);
    expect(fields.get("Canonical")).toEqual(["https://gleamwallet.app/.well-known/security.txt"]);
  });
});
