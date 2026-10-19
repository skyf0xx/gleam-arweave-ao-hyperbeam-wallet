import { useEffect, useState } from "react";
import { addressEmphasisPick, type RuntimePort, type SecurityPhrase } from "@gleam/core";

let pending: Promise<number | null> | null = null;
let settled: { pick: number | null } | null = null;

function loadPick(runtime: RuntimePort): Promise<number | null> {
  pending ??= runtime
    .send<void, SecurityPhrase | null>({ type: "getSecurityPhrase", payload: undefined })
    .then((phrase) => addressEmphasisPick(phrase?.word ?? null))
    .catch(() => null)
    .then((pick) => {
      settled = { pick };
      return pick;
    });
  return pending;
}

/** Drops the cached pick so the next reader sees a changed security phrase. */
export function forgetAddressEmphasis(): void {
  pending = null;
  settled = null;
}

/**
 * The user's address emphasis pick, read once per page from the security
 * phrase. `null` (the default middle chunks) until it loads or when no
 * phrase is set.
 */
export function useAddressEmphasis(runtime: RuntimePort): number | null {
  const [pick, setPick] = useState<number | null>(settled?.pick ?? null);
  useEffect(() => {
    let cancelled = false;
    void loadPick(runtime).then((loaded) => {
      if (!cancelled) setPick(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime]);
  return pick;
}
