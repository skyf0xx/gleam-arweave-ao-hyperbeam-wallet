import { fetchScanCount } from "@gleam/core/src/scan/index.ts";

export interface ScansHandlerDeps {
  apiUrl: string;
  /** The running extension's version, read per call; it is the release whose scans are counted. */
  version: () => string;
  fetchImpl?: typeof fetch;
}

export class ScansHandler {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: ScansHandlerDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** Scans attesting this build's release, or null when the API can't say. */
  count(): Promise<number | null> {
    return fetchScanCount({ apiUrl: this.deps.apiUrl, release: this.deps.version(), fetchImpl: this.fetchImpl });
  }
}
