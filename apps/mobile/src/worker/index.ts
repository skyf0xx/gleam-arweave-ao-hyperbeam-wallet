import type { Endpoint } from "comlink";
import { createRuntime } from "@gleam/runtime/src/create-runtime.ts";
import { exposeRuntimeHost } from "./host";
import { createWorkerPlatform } from "./platform";

/**
 * The app's background: `createRuntime` and every key it unlocks live in
 * this worker, off the UI thread. The UI reaches it only through
 * `createWorkerRuntimePort`.
 */
// The app compiles against DOM types; here `self` is the worker's global scope.
const scope = self as unknown as Endpoint;
const runtime = createRuntime(createWorkerPlatform(scope));
exposeRuntimeHost(runtime, scope);
runtime.start();
// The worker starts only when the app does.
runtime.onBrowserStartup();
