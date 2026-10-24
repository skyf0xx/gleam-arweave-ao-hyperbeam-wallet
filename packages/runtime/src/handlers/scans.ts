import { fetchScanStats, type ScanStats } from "@gleam/core/src/scan/index.ts";

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

  /** Scans attesting this build's release and its paid places left, or null when the API can't say. */
  stats(): Promise<ScanStats | null> {
    return fetchScanStats({ apiUrl: this.deps.apiUrl, release: this.deps.version(), fetchImpl: this.fetchImpl });
  }
}
