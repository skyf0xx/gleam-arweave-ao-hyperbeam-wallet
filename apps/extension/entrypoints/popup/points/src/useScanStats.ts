import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, ScanStats } from "@gleam/core";

const SCAN_STATS_STALE_MS = 10 * 60_000;

/** The running release's scan count, paid places left and next reward; shared by Points and Settings. */
export function useScanStats(runtime: RuntimePort) {
  return useQuery({
    queryKey: ["scans", "stats"],
    queryFn: () => runtime.send<undefined, ScanStats | null>({ type: "getScanStats", payload: undefined }),
    staleTime: SCAN_STATS_STALE_MS,
    retry: false,
  });
}
