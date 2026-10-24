import type { ProviderSurfaceMethod } from "@gleam/messaging/src/page-protocol.ts";
import type { OtherWalletReport, ProviderTransport } from "../src/transport";

export interface FakeRequest {
  method: ProviderSurfaceMethod;
  params: unknown;
  signal: AbortSignal;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
}

/** A `ProviderTransport` that records what the provider sends and lets a test answer it. */
export interface FakeTransport {
  transport: ProviderTransport;
  requests: FakeRequest[];
  reports: OtherWalletReport[];
  modeRequests: () => number;
  lastRequest: () => FakeRequest;
  push: (event: string, data: unknown) => void;
  siteMode: (useGleam: boolean) => void;
}

export function createFakeTransport(): FakeTransport {
  const requests: FakeRequest[] = [];
  const reports: OtherWalletReport[] = [];
  const eventListeners = new Set<(event: string, data: unknown) => void>();
  const siteModeListeners = new Set<(useGleam: boolean) => void>();
  let modeRequests = 0;

  const transport: ProviderTransport = {
    request(method, params, signal) {
      return new Promise((resolve, reject) => {
        requests.push({ method, params, signal, resolve, reject });
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    requestSiteMode() {
      modeRequests += 1;
    },
    onSiteMode(listener) {
      siteModeListeners.add(listener);
      return () => siteModeListeners.delete(listener);
    },
    reportOtherWallet(report) {
      reports.push(report);
    },
  };

  return {
    transport,
    requests,
    reports,
    modeRequests: () => modeRequests,
    lastRequest: () => {
      const request = requests.at(-1);
      if (!request) throw new Error("The provider sent no request.");
      return request;
    },
    push: (event, data) => {
      for (const listener of [...eventListeners]) listener(event, data);
    },
    siteMode: (useGleam) => {
      for (const listener of [...siteModeListeners]) listener(useGleam);
    },
  };
}
