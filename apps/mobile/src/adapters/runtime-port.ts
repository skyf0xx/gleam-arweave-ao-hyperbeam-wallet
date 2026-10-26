import * as Comlink from "comlink";
import type { RuntimeMessage, RuntimePort } from "@gleam/core";
import type { RuntimeHost } from "../worker/host";

/**
 * `RuntimePort` over `comlink` to the runtime worker. Requests and replies
 * are structured clones, and a handler's `Error` arrives as an `Error` with
 * the same message, as it does over extension messaging.
 */
export function createWorkerRuntimePort(endpoint: Comlink.Endpoint): RuntimePort {
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
  return {
    async send<TPayload, TResponse>(message: RuntimeMessage<TPayload>): Promise<TResponse> {
      const reply = host.dispatch(message.type, message.payload).finally(() => {
        answered = true;
      });
      return (await Promise.race([reply, loadFailure])) as TResponse;
    },
    // The worker sends the UI no runtime messages, so no handler would ever be called.
    onMessage: () => () => {},
  };
}
