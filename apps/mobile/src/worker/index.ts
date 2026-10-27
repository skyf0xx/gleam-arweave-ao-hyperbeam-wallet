import type { Endpoint } from "comlink";
import { createRuntime } from "@gleam/runtime/src/create-runtime.ts";
import { WorkerTimer } from "../adapters/timer";
import { exposeRuntimeHost } from "./host";
import { LINK_NOTICE } from "./link-notice";
import { createWorkerPlatform } from "./platform";

/**
 * The app's background: `createRuntime` and every key it unlocks live in
 * this worker, off the UI thread. The UI reaches it only through
 * `createWorkerRuntimePort`.
 */
// The app compiles against DOM types; here `self` is the worker's global scope.
const scope = self as unknown as Endpoint;
const timer = new WorkerTimer();
const runtime = createRuntime(createWorkerPlatform(scope, timer));
exposeRuntimeHost(
  runtime,
  { onResume: () => timer.catchUp(), onLinkNotice: (message) => scope.postMessage({ type: LINK_NOTICE, message }) },
  scope,
);
runtime.start();
// The worker starts only when the app does.
runtime.onBrowserStartup();
// The app has no install event. The install work only fills in network
// settings when none are stored, so it is safe on every start.
runtime.onInstalled("install");
