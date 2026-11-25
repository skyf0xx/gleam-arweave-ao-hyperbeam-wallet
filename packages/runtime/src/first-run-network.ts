import type { NetworkSettings, StoragePort } from "@gleam/core";
import { resolveInitialGatewayUrl } from "@gleam/core/src/arweave/first-run-gateway.ts";
import type { ReadsHandler } from "./handlers/reads";
import { NETWORK_SETTINGS_KEY } from "./storage-keys";
import { updateStored } from "./storage-update";

/**
 * First-run gateway fallback: if `local:networkSettings` has never been
 * written, checks whether `arweave.net` actually answers as a gateway
 * and, if not, tries `FALLBACK_GATEWAY_URLS` in order
 * (`resolveInitialGatewayUrl` — pure, given `fetch`). Only ever writes
 * `NETWORK_SETTINGS_KEY` when it was previously empty, so a user's own
 * gateway choice is never touched. Errors are swallowed: this must never
 * block startup, and `stored-data.ts`'s `DEFAULT_NETWORK_SETTINGS` fallback
 * already covers "nothing was ever written" for every other read path.
 */
export async function initializeNetworkSettingsIfMissing(
  storage: StoragePort,
  reads: Pick<ReadsHandler, "getNetworkSettings">,
): Promise<void> {
  try {
    const existing = await storage.get<NetworkSettings>(NETWORK_SETTINGS_KEY);
    if (existing !== null) return;

    const gatewayUrl = await resolveInitialGatewayUrl();
    const settings = await reads.getNetworkSettings();
    // The probe takes a while; settings the user saved meanwhile win.
    await updateStored(storage, NETWORK_SETTINGS_KEY, (current) =>
      current === null ? { ...settings, gatewayUrl } : undefined,
    );
  } catch {
    // Never block startup over a first-run gateway probe.
  }
}
