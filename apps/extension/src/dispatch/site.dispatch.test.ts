import { describe, expect, it } from "vitest";
import { SITE_ORIGIN } from "../site-pages";
import { isSiteOrigin } from "./site";

describe("isSiteOrigin", () => {
  const LOCAL = ["http://localhost:8000", "http://localhost", "http://127.0.0.1:5173"];

  it("accepts the site in every build", () => {
    expect(isSiteOrigin(SITE_ORIGIN, false)).toBe(true);
    expect(isSiteOrigin(SITE_ORIGIN, true)).toBe(true);
  });

  it.each(LOCAL)("refuses %s in a production build", (origin) => {
    expect(isSiteOrigin(origin, false)).toBe(false);
  });

  it.each(LOCAL)("accepts %s in a development build", (origin) => {
    expect(isSiteOrigin(origin, true)).toBe(true);
  });

  it.each([
    "https://localhost:8000",
    "http://foo.localhost:8000",
    "http://localhost.evil.example",
    "http://192.168.1.10:8000",
    "http://[::1]:8000",
    "http://localhost:8000/attest.html",
    "null",
    "",
    undefined,
  ])("refuses %s even in a development build", (origin) => {
    expect(isSiteOrigin(origin, true)).toBe(false);
  });
});
