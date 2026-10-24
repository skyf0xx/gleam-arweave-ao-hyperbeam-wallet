import type { PasskeyStatus, RuntimePort } from "@gleam/core";
import { readPasskeyPrf } from "../../../passkey/webauthn";

/** Runs the passkey prompt, then unlocks with its PRF output. */
export async function unlockWithPasskey(
  runtime: RuntimePort,
  status: Extract<PasskeyStatus, { enrolled: true }>,
): Promise<{ unlockedWalletIds: string[] }> {
  const prfOutput = await readPasskeyPrf(status);
  return runtime.send<{ credentialId: string; prfOutput: string }, { unlockedWalletIds: string[] }>({
    type: "unlockWithPasskey",
    payload: { credentialId: status.credentialId, prfOutput },
  });
}
