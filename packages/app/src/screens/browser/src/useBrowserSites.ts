import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimePort } from "@gleam/core";
import type { BrowserVisit } from "./history";

export interface BrowserSites {
  saved: string[];
  recent: string[];
  /** A saved site's stored icon, by origin. */
  icons: Record<string, string>;
  history: BrowserVisit[];
}

const NONE: BrowserSites = { saved: [], recent: [], icons: {}, history: [] };

/** Applies saves and removals still in flight, a new save first, as the list orders by most recent. */
function withPending(saved: string[], pending: ReadonlyMap<string, boolean>): string[] {
  if (pending.size === 0) return saved;
  const kept = saved.filter((origin) => pending.get(origin) !== false);
  const added = [...pending].filter(([origin, value]) => value && !kept.includes(origin)).map(([origin]) => origin);
  return [...added, ...kept];
}

/** The saved and recent origins and the page history, most recent first. A failed read leaves them empty. */
export function useBrowserSites(runtime: RuntimePort) {
  const [sites, setSites] = useState<BrowserSites>(NONE);
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  // The latest change per origin, so an older request settling doesn't clear a newer tap.
  const latest = useRef(new Map<string, number>());

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

  /**
   * Shows `origin` as saved or not at once, then runs `request`. The stored
   * list replaces the guess once the request settles, so a failed save
   * reverts on its own.
   */
  const setSaved = useCallback(
    (origin: string, value: boolean, request: () => Promise<unknown>) => {
      const id = (latest.current.get(origin) ?? 0) + 1;
      latest.current.set(origin, id);
      setPending((current) => new Map(current).set(origin, value));
      void request()
        .catch(() => undefined)
        .then(reload)
        .then(() => {
          if (latest.current.get(origin) !== id) return;
          setPending((current) => {
            const next = new Map(current);
            next.delete(origin);
            return next;
          });
        });
    },
    [reload],
  );

  return { ...sites, saved: withPending(sites.saved, pending), reload, setSaved };
}
