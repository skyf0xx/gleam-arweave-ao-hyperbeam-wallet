import { fakeBrowser } from "./fake-browser.testing";
import { describeStoragePort } from "@gleam/runtime/testing/index.ts";
import { WxtStoragePort } from "./storage";

describeStoragePort("WxtStoragePort", async () => ({
  port: new WxtStoragePort(),
  cleanup: () => fakeBrowser.reset(),
}));
