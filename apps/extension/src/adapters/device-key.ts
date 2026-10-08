import { deviceKeyThumbprint, type DevicePublicJwk } from "@gleam/core/src/points/index.ts";

export interface DeviceKey {
  /** RFC 7638 thumbprint of `publicKey`; the server's device id. */
  id: string;
  publicKey: DevicePublicJwk;
  privateKey: CryptoKey;
}

const DB_NAME = "gleam-points";
const STORE = "device";
const RECORD_KEY = "current";

let pending: Promise<DeviceKey> | null = null;

/**
 * The install's Gleam Points device key, created on first use.
 *
 * It lives in IndexedDB rather than `chrome.storage`, because IndexedDB
 * can hold a `CryptoKey` object itself. The private key is generated
 * non-extractable, so its bytes can never be read back out, not even by
 * extension code. Calls share one promise so two concurrent first uses
 * can't create two keys.
 */
export function loadOrCreateDeviceKey(): Promise<DeviceKey> {
  pending ??= loadOrCreate().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

async function loadOrCreate(): Promise<DeviceKey> {
  const db = await openDb();
  try {
    const existing = await request<DeviceKey | undefined>(db.transaction(STORE).objectStore(STORE).get(RECORD_KEY));
    if (existing) return existing;

    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const publicKey: DevicePublicJwk = { kty: "EC", crv: "P-256", x: exported.x!, y: exported.y! };
    const created: DeviceKey = { id: await deviceKeyThumbprint(publicKey), publicKey, privateKey: pair.privateKey };

    // `add` fails if another context (popup vs. background) won the race,
    // in which case the stored key is the one to use.
    try {
      await request(db.transaction(STORE, "readwrite").objectStore(STORE).add(created, RECORD_KEY));
      return created;
    } catch {
      const winner = await request<DeviceKey | undefined>(db.transaction(STORE).objectStore(STORE).get(RECORD_KEY));
      if (!winner) throw new Error("Couldn't store the Gleam Points device key.");
      return winner;
    }
  } finally {
    db.close();
  }
}

function openDb(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  return request(open);
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Test-only: forgets the in-memory promise so a fresh IndexedDB is read. */
export function resetDeviceKeyCacheForTests(): void {
  pending = null;
}
