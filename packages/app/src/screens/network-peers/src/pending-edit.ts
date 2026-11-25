import type { EphemeralStatePort } from "../../../app-platform/types";

export interface PendingNetworkEdit {
  kind: "gateway" | "bundler" | "peer";
  url: string;
}

const PENDING_EDIT_KEY = "session:pendingNetworkEdit";

export async function loadPendingEdit(store: EphemeralStatePort): Promise<PendingNetworkEdit | null> {
  try {
    const value = (await store.get(PENDING_EDIT_KEY)) as { kind?: unknown; url?: unknown } | undefined;
    if (
      value !== undefined &&
      value !== null &&
      typeof value === "object" &&
      (value.kind === "gateway" || value.kind === "bundler" || value.kind === "peer") &&
      typeof value.url === "string"
    ) {
      return { kind: value.kind, url: value.url };
    }
    return null;
  } catch {
    return null;
  }
}

export async function savePendingEdit(store: EphemeralStatePort, edit: PendingNetworkEdit): Promise<void> {
  try {
    await store.set(PENDING_EDIT_KEY, edit);
  } catch {
    // Best-effort — if this fails, the user just has to re-paste the URL.
  }
}

export async function clearPendingEdit(store: EphemeralStatePort): Promise<void> {
  try {
    await store.remove(PENDING_EDIT_KEY);
  } catch {
    // Nothing to clean up if this fails.
  }
}
