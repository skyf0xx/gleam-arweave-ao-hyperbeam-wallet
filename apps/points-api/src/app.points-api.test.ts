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
