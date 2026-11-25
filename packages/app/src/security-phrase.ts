import { readSecurityPhrase, type RuntimePort, type SecurityPhrase } from "@gleam/core";

/** The stored phrase, validated; null when none is set. Rejects when the read fails. */
export async function fetchSecurityPhrase(runtime: RuntimePort): Promise<SecurityPhrase | null> {
  return readSecurityPhrase(await runtime.send<void, unknown>({ type: "getSecurityPhrase", payload: undefined }));
}

/** Null when none is set or it can't be read. */
export async function loadSecurityPhrase(runtime: RuntimePort): Promise<SecurityPhrase | null> {
  try {
    return await fetchSecurityPhrase(runtime);
  } catch {
    return null;
  }
}
