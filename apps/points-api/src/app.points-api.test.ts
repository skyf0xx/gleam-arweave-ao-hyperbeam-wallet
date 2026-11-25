// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createTestDb } from "./testing/test-db";

describe("GET /health", () => {
  it("reports ok once the database answers", async () => {
    const app = createApp({ db: await createTestDb() });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("a body that isn't JSON", () => {
  const post = async (path: string) => {
    const app = createApp({ db: await createTestDb() });
    const response = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    return { status: response.status, json: await response.json() };
  };

  it.each(["/register", "/invite/redeem", "/heartbeat", "/leave", "/me"])("gets the wallet's malformed answer from %s", async (path) => {
    expect(await post(path)).toEqual({ status: 400, json: { error: "Malformed request." } });
  });

  it("gets the invite page's answer from /invite/check", async () => {
    expect(await post("/invite/check")).toEqual({ status: 400, json: { error: "Malformed invite code." } });
  });

  it.each(["/attestations", "/attestations/check"])("gets malformed_request from %s", async (path) => {
    const { status, json } = await post(path);
    expect([status, json.code]).toEqual([400, "malformed_request"]);
  });
});

describe("extension CORS", () => {
  const preflight = async (path: string, origin: string) => {
    const app = createApp({ db: await createTestDb() });
    const response = await app.request(path, {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    return response.headers.get("access-control-allow-origin");
  };

  it.each(["/invite/redeem", "/register", "/heartbeat", "/leave", "/me"])("lets an extension call %s", async (path) => {
    expect(await preflight(path, "chrome-extension://einabcphdmlicabnjllaaallnebfkmki")).toBe(
      "chrome-extension://einabcphdmlicabnjllaaallnebfkmki",
    );
  });

  it.each(["https://localhost", "capacitor://localhost"])("lets the mobile app at %s call the wallet endpoints", async (origin) => {
    expect(await preflight("/invite/redeem", origin)).toBe(origin);
  });

  it("doesn't open the extension endpoints to web pages", async () => {
    expect(await preflight("/register", "https://evil.example")).toBeNull();
  });
});
