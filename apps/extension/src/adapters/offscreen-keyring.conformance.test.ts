import { describeSessionKeyStorePort } from "@gleam/runtime/testing/index.ts";
import { FakeOffscreen } from "./offscreen-keyring.testing";
import { OffscreenKeyring } from "./offscreen-keyring";

describeSessionKeyStorePort("OffscreenKeyring", async () => {
  const host = new FakeOffscreen();
  const keyring = new OffscreenKeyring(host, { requestMs: 1_000, connectMs: 200 });
  host.keyring = keyring;
  return { port: keyring, cleanup: () => host.closeDocument().catch(() => undefined) };
});
