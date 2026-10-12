// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createTestDb } from "./test-db";

describe("GET /health", () => {
  it("reports ok once the database answers", async () => {
    const app = createApp({ db: await createTestDb() });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
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

  it("doesn't open the extension endpoints to web pages", async () => {
    expect(await preflight("/register", "https://evil.example")).toBeNull();
  });
});
