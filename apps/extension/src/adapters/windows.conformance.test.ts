import { vi } from "vitest";
import { fakeBrowser } from "./fake-browser.testing";
import { describeApprovalPresenterPort } from "@gleam/runtime/testing/index.ts";
import { WxtStoragePort } from "./storage";
import { WindowApprovalPresenter } from "./windows";

describeApprovalPresenterPort("WindowApprovalPresenter", async () => {
  // The fake keeps no URL, so the window a request opened is found by what `create` was asked for.
  const windowIds = new Map<string, number>();
  const create = fakeBrowser.windows.create.bind(fakeBrowser.windows);
  const spy = vi.spyOn(fakeBrowser.windows, "create").mockImplementation(async (options) => {
    const window = await create(options);
    const requestId = new URL(options?.url as string, "chrome-extension://test").searchParams.get("requestId");
    if (requestId && window?.id !== undefined) windowIds.set(requestId, window.id);
    return window;
  });
  const windowFor = (requestId: string) => {
    const id = windowIds.get(requestId);
    if (id === undefined) throw new Error(`No window was opened for ${requestId}.`);
    return id;
  };

  return {
    port: new WindowApprovalPresenter(new WxtStoragePort()),
    userDismiss: (requestId) => fakeBrowser.windows.remove(windowFor(requestId)),
    isShowing: async (requestId) => {
      const id = windowIds.get(requestId);
      return id !== undefined && (await fakeBrowser.windows.getAll()).some((window) => window.id === id);
    },
    cleanup: () => {
      spy.mockRestore();
      fakeBrowser.reset();
    },
  };
});
