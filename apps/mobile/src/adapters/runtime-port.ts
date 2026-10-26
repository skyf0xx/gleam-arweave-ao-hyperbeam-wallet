import * as Comlink from "comlink";
import type { RuntimeMessage, RuntimePort } from "@gleam/core";
import type { RuntimeHost } from "../worker/host";

/**
 * `RuntimePort` over `comlink` to the runtime worker. Requests and replies
 * are structured clones, and a handler's `Error` arrives as an `Error` with
 * the same message, as it does over extension messaging.
 */
export function createWorkerRuntimePort(endpoint: Comlink.Endpoint): RuntimePort & Pick<RuntimeHost, "resume" | "pageCall" | "tabClosed"> {
  const host = Comlink.wrap<RuntimeHost>(endpoint);
  // A worker that fails to load never answers, so without this every call
  // would wait forever. Once it has answered, a later uncaught error in it
  // isn't treated as fatal.
  let answered = false;
  const loadFailure = new Promise<never>((_, reject) => {
    endpoint.addEventListener("error", () => {
      if (!answered) reject(new Error("Gleam couldn't start. Close the app and open it again."));
    });
  });
  loadFailure.catch(() => {});
  const answer = <T>(call: Promise<T>): Promise<T> =>
    Promise.race([
      call.finally(() => {
        answered = true;
      }),
      loadFailure,
    ]);
  return {
    async send<TPayload, TResponse>(message: RuntimeMessage<TPayload>): Promise<TResponse> {
      return (await answer(host.dispatch(message.type, message.payload))) as TResponse;
    },
    resume: () => host.resume(),
    pageCall: (type, data, origin, tabId) => answer(host.pageCall(type, data, origin, tabId)),
    tabClosed: (tabId) => answer(host.tabClosed(tabId)),
    // The worker sends the UI no runtime messages, so no handler would ever be called.
    onMessage: () => () => {},
  };
}
