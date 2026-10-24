import { describe, expect, it } from "vitest";
import { isSecureSigningOrigin } from "./signing-origin";

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
