import { useCallback, useEffect, useState } from "react";
import type { RuntimePort } from "@gleam/core";

export interface BrowserSites {
  saved: string[];
  recent: string[];
}

const NONE: BrowserSites = { saved: [], recent: [] };

/** The saved and recent origins, most recent first. A failed read leaves them empty. */
export function useBrowserSites(runtime: RuntimePort) {
  const [sites, setSites] = useState<BrowserSites>(NONE);

  const reload = useCallback(async () => {
    try {
      setSites(await runtime.send<void, BrowserSites>({ type: "listBrowserSites", payload: undefined }));
    } catch {
      setSites(NONE);
    }
  }, [runtime]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...sites, reload };
}
