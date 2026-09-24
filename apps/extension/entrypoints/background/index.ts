import { defineExtensionMessaging } from "@webext-core/messaging";
import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import {
  PERMISSION_TYPES,
  PROVIDER_METHODS,
  bytesToBase64,
  missingPermissions,
  verifyMessage,
  type PermissionType,
} from "@gleam/core";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import {
  PROVIDER_EVENT,
  PROVIDER_SURFACE_METHODS,
  type ConnectEventPayload,
  type DisconnectEventPayload,
  type ProviderEventName,
  type ProviderSurfaceMethod,
  type WalletSwitchEventPayload,
} from "@gleam/messaging/src/page-protocol.ts";
import { WxtStoragePort } from "@/src/adapters/storage";
import { WxtWindowPort } from "@/src/adapters/windows";
import { WalletLifecycleHandler } from "@/src/handlers/wallet-lifecycle";
import { ReadsHandler, registerActivityPromotionAlarm } from "@/src/handlers/reads";
import { TransferHandler } from "@/src/handlers/transfer";
import { UploadHandler } from "@/src/handlers/upload";
import { ApprovalHandler } from "@/src/handlers/approval";
import {
  decodeProviderParams,
  encodeProviderResult,
  readBytes,
  readDataItem,
  readDataItems,
  readEncryptAlgorithm,
  readHashAlgorithm,
  readSaltLength,
  readTransaction,
  type ProviderArgs,
} from "@/src/handlers/provider-params";
import { contentScriptOrigin, isExtensionPageSender } from "@/src/sender";

/**
 * The background service worker: builds the adapters and handlers and
 * registers every `ProtocolMap` method.
 *
 * Every message is checked against Chrome's `sender`, never against
 * anything the message body claims. `providerCall` is the only method a
 * content script may send, and its origin is the sending frame's origin.
 * Every other method (key export, wallet creation, approval resolution,
 * settings) is accepted only from this extension's own pages. Within
 * `providerCall`, the method must also be in `PROVIDER_METHODS`, which is
 * disjoint from the approval and key tiers.
 */
const messenger = defineExtensionMessaging<ProtocolMap>();
const extensionBaseUrl = browser.runtime.getURL("");

/**
 * `onMessage` for methods only this extension's pages may call. A content
 * script shares the extension's messaging channel, so without this check a
 * compromised page's content script could export keys or approve its own
 * requests.
 */
const onExtensionMessage: typeof messenger.onMessage = (type, onReceived) =>
  messenger.onMessage(type, (message) => {
    if (!isExtensionPageSender(message.sender, extensionBaseUrl)) {
      throw new Error(`"${String(type)}" can only be called from the Gleam extension.`);
    }
    return onReceived(message);
  });

const storage = new WxtStoragePort();
const windows = new WxtWindowPort(storage);

const lifecycle = new WalletLifecycleHandler(storage);
const reads = new ReadsHandler(storage);
const transfer = new TransferHandler(storage);
const upload = new UploadHandler(storage);
const approval = new ApprovalHandler(storage, windows, transfer);

// Advances locally-pending activity entries to confirmed on a background
// interval, independent of any popup being open — see reads.ts's own
// doc comment on registerActivityPromotionAlarm.
registerActivityPromotionAlarm(reads);

// No runtime.onSuspend handler clears the key cache. onSuspend fires when
// the worker idles out (~30s), not only on browser shutdown, so clearing
// there locked every wallet behind the user's back.
// The cache lives in chrome.storage.session, which is memory-only and
// dropped when the browser closes; lockWallet and auto-lock clear it.

/**
 * Finds every open tab whose URL origin matches `origin` exactly — the
 * only way this task's access-control rule ("only a connected dApp...
 * receives these events") can be enforced for a *push*, since nothing
 * about `providerEvent`'s wire shape itself carries an origin check (see
 * `protocol.ts`'s doc comment on that method). `browser.tabs.query`'s own
 * `url` match pattern can't express "exact origin, any path" directly, so
 * this filters candidate tabs (queried broadly by scheme) down to an exact
 * `new URL(tab.url).origin === origin` match by hand.
 */
async function findTabsForOrigin(origin: string): Promise<number[]> {
  const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] });
  const ids: number[] = [];
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || !tab.url) continue;
    try {
      if (new URL(tab.url).origin === origin) ids.push(tab.id);
    } catch {
      // Not a parseable URL — never a candidate.
    }
  }
  return ids;
}

/**
 * Sends a `providerEvent` push to every tab currently showing `origin` —
 * never a broadcast to every open tab. Each `sendMessage` targets one
 * `tabId` at a time (`@webext-core/messaging`'s targeted-send overload);
 * a tab with no content script listening (e.g. mid-navigation) simply
 * rejects that one send, which is swallowed here rather than failing the
 * caller — a missed push is not itself an error the connect/disconnect/
 * switchWallet flow should surface.
 */
async function emitProviderEventToOrigin<TName extends ProviderEventName>(
  origin: string,
  event: TName,
  data: TName extends typeof PROVIDER_EVENT.CONNECT
    ? ConnectEventPayload
    : TName extends typeof PROVIDER_EVENT.DISCONNECT
      ? DisconnectEventPayload
      : WalletSwitchEventPayload,
): Promise<void> {
  const tabIds = await findTabsForOrigin(origin);
  await Promise.all(
    tabIds.map((tabId) =>
      messenger.sendMessage("providerEvent", { event, data }, tabId).catch(() => undefined),
    ),
  );
}

/**
 * `walletSwitch` broadcast for an active-account change: unlike
 * connect/disconnect (inherently one-origin actions), a wallet switch
 * affects the whole extension, so every origin currently holding an
 * active `Grant` gets the push — never every open tab, per this task's
 * access-control rule. Origins with no Grant, or an expired one
 * (`findActiveGrant`'s own expiry check applies per-origin via
 * `getConnectedApps`, which is unfiltered by expiry — filtered here by
 * re-checking `findActiveGrant` per origin so an expired Grant is
 * silently excluded rather than pushed to).
 */
async function broadcastWalletSwitch(address: string): Promise<void> {
  const grants = await approval.getConnectedApps();
  const origins = [...new Set(grants.map((grant) => grant.origin))];
  await Promise.all(
    origins.map(async (origin) => {
      const activeGrant = await approval.findActiveGrant(origin);
      if (!activeGrant) return;
      await emitProviderEventToOrigin(origin, PROVIDER_EVENT.WALLET_SWITCH, { address });
    }),
  );
}

/**
 * Maps a `PROVIDER_SURFACE_METHODS` name + already-origin-checked params
 * into the actual read/approval-flow work — the "business logic" side of
 * the provider surface, as distinct from `providerCall`'s own job (which
 * is purely the privilege-tier gate). No `WalletState` read here ever
 * exposes an address for an origin without an active `Grant` — every
 * branch below either reads through `approval.findActiveGrant` first or
 * is itself the `connect` call that creates one.
 */
async function handleProviderCall(
  origin: string,
  method: ProviderSurfaceMethod,
  params: ProviderArgs,
): Promise<unknown> {
  if (method === "connect") {
    const requested = Array.isArray((params as { permissions?: unknown } | undefined)?.permissions)
      ? ((params as { permissions: unknown[] }).permissions.filter(
          (value): value is PermissionType =>
            typeof value === "string" && (PERMISSION_TYPES as readonly string[]).includes(value),
        ) as PermissionType[])
      : [];

    const state = await lifecycle.getState();
    const walletId = state.session?.unlockedWalletIds[0] ?? state.activeWalletId;
    if (!walletId) {
      throw new Error("No unlocked wallet is available to connect this app to.");
    }

    const result = await approval.requestApproval({
      kind: "connect",
      origin,
      walletId,
      requestedPermissions: requested.length > 0 ? requested : ["ACCESS_ADDRESS"],
    });

    // Fires only once the user actually approved (a rejected/timed-out
    // `requestApproval` call throws, so this line is unreached for those
    // cases) — matches ArConnect's own "connect event fires once connect()
    // resolves" convention, per this task's INTENT.
    const connectedState = await lifecycle.getState();
    const connectedWallet = connectedState.wallets.find((candidate) => candidate.id === walletId);
    if (connectedWallet) {
      void emitProviderEventToOrigin(origin, PROVIDER_EVENT.CONNECT, {
        activeAddress: connectedWallet.address,
      });
    }

    return result;
  }

  if (method === "disconnect") {
    await approval.revokeGrant({ origin });
    void emitProviderEventToOrigin(origin, PROVIDER_EVENT.DISCONNECT, {});
    return undefined;
  }

  const grant = await approval.findActiveGrant(origin);
  if (!grant) {
    throw new Error(`"${origin}" is not connected. Call connect() first.`);
  }

  const missing = missingPermissions(method, grant.permissions);
  if (missing.length > 0) {
    throw new Error(`Missing permission(s) for "${method}": ${missing.join(", ")}`);
  }

  const state = await lifecycle.getState();
  const wallet = state.wallets.find((candidate) => candidate.id === grant.walletId) ?? null;

  switch (method) {
    case "getPermissions":
      return grant.permissions;
    case "getActiveAddress":
      return wallet?.address ?? null;
    case "getAllAddresses":
      return state.wallets.map((candidate) => candidate.address);
    case "getActivePublicKey":
      return wallet?.publicKey ?? null;
    case "getWalletNames":
      return Object.fromEntries(state.wallets.map((candidate) => [candidate.address, candidate.name]));
    case "getArweaveConfig":
      return { protocol: "https", host: "arweave.net", port: 443 };
    case "getBalances":
      if (!wallet) throw new Error("No active wallet to read balances for.");
      return { ar: await reads.getBalance({ address: wallet.address }) };

    case "sign":
    case "dispatch": {
      const transaction = readTransaction(params.transaction, method);
      const { gatewayUrl } = await reads.getNetworkSettings();
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: grant.walletId,
        recipient: transaction.target ?? null,
        amount: transaction.target ? (transaction.quantity ?? "0") : null,
        fee: null,
        payload: transaction.data,
        tags: transaction.tags,
        gatewayUrl,
        target: transaction.target,
        quantity: transaction.quantity,
        reward: transaction.reward,
        last_tx: transaction.last_tx,
      });
    }

    case "signDataItem":
    case "batchSignDataItem": {
      const items =
        method === "signDataItem"
          ? [readDataItem(params.dataItem, method)]
          : readDataItems(params.dataItems);
      const [first] = items;
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: grant.walletId,
        payload: first!.data,
        tags: first!.tags,
        dataItems: items.map((item) => ({
          data: bytesToBase64(item.data),
          tags: item.tags,
          target: item.target,
          anchor: item.anchor,
        })),
      });
    }

    case "encrypt":
    case "decrypt":
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: grant.walletId,
        payload: readBytes(params.data, "data", method === "encrypt" ? "utf8" : "reject"),
        encryptAlgorithm: readEncryptAlgorithm(params.options, method),
      });

    case "transferAoTokens": {
      const transferParams = params as { token?: string; recipient?: string; amount?: string };
      if (!transferParams.token || !transferParams.recipient || !transferParams.amount) {
        throw new Error("transferAoTokens requires token, recipient, and amount.");
      }
      return approval.requestApproval({
        kind: "transferAoTokens",
        origin,
        walletId: grant.walletId,
        recipient: transferParams.recipient,
        amount: transferParams.amount,
        fee: null,
        token: transferParams.token,
        payload: new Uint8Array(),
        tags: [],
      });
    }

    case "signature":
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: grant.walletId,
        payload: readBytes(params.data, "data"),
        saltLength: readSaltLength(params.options, method),
      });

    case "signMessage":
    case "privateHash":
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: grant.walletId,
        payload: readBytes(params.data, "data"),
        hashAlgorithm: readHashAlgorithm(params.options, method),
      });

    case "verifyMessage": {
      // Verification uses only public material, so it needs no approval.
      // Wander defaults `publicKey` to the active wallet's key.
      const data = readBytes(params.data, "data");
      const signature = readBytes(params.signature, "signature", "base64url");
      const publicKey = params.publicKey ?? wallet?.publicKey;
      if (typeof publicKey !== "string" || publicKey.length === 0) {
        throw new Error("verifyMessage needs a publicKey when no wallet is active.");
      }
      return verifyMessage(
        publicKey,
        data.buffer,
        signature.buffer,
        readHashAlgorithm(params.options, "verifyMessage"),
      );
    }

    case "tokenBalance": {
      if (!wallet) throw new Error("No active wallet to read a token balance for.");
      const tokenParams = params as { id?: string };
      if (!tokenParams.id) throw new Error("tokenBalance requires an id.");
      return reads.tokenBalance({ address: wallet.address, id: tokenParams.id });
    }

    case "userTokens": {
      if (!wallet) throw new Error("No active wallet to read tokens for.");
      const tokenParams = params as { options?: { cursor?: string; limit?: number } };
      return reads.userTokens({ address: wallet.address, options: tokenParams.options });
    }

    default:
      // Not a `never`-exhaustive check: `ProviderSurfaceMethod` (messaging
      // layer's scope) can grow ahead of this switch (provider-bridge's
      // scope) being updated to handle a new method, so an unhandled
      // method is a named runtime failure here rather than a compile
      // error that would block every other layer's commits.
      throw new Error(`Provider method "${String(method)}" is not implemented yet.`);
  }
}

async function setLockedIcon(locked: boolean) {
  const suffix = locked ? '-locked' : ''

  await browser.action.setIcon({
    path: {
      16: `/icon/16${suffix}.png`,
      32: `/icon/32${suffix}.png`,
      48: `/icon/48${suffix}.png`,
      128: `/icon/128${suffix}.png`,
    },
  })
}

// wallet lifecycle
onExtensionMessage("createWallet", (message) => lifecycle.createWallet(message.data));
onExtensionMessage("importWallet", (message) => lifecycle.importWallet(message.data));
onExtensionMessage("deleteWallet", async (message) => {
  const revoked = await approval.revokeWalletAccess(message.data.walletId);
  await lifecycle.deleteWallet(message.data);
  for (const origin of revoked) void emitProviderEventToOrigin(origin, PROVIDER_EVENT.DISCONNECT, {});
});
onExtensionMessage("renameWallet", (message) => lifecycle.renameWallet(message.data));
onExtensionMessage("switchWallet", async (message) => {
  await lifecycle.switchWallet(message.data);
  // `switchWallet`'s locked signature returns `void`, so the resulting
  // active address is derived here from `getState()` after the call
  // resolves, per this task's INHERITED DECISIONS note.
  const state = await lifecycle.getState();
  const active = state.wallets.find((candidate) => candidate.id === state.activeWalletId);
  if (active) {
    void broadcastWalletSwitch(active.address);
  }
});
onExtensionMessage("exportWallet", (message) => lifecycle.exportWallet(message.data));
onExtensionMessage("lockWallet", async () => {
  await lifecycle.lockWallet();
  void setLockedIcon(true);
});
onExtensionMessage("unlockWallet", async (message) => {
  const result = await lifecycle.unlockWallet(message.data);
  void setLockedIcon(false);
  return result;
});
onExtensionMessage("resetAllWallets", async () => {
  // Grants go first, here and in deleteWallet: a removal that fails
  // part-way must not leave a dApp connected to a wallet that is gone.
  const revoked = await approval.revokeAllAccess();
  await lifecycle.resetAllWallets();
  for (const origin of revoked) void emitProviderEventToOrigin(origin, PROVIDER_EVENT.DISCONNECT, {});
});

// reads
onExtensionMessage("getState", () => lifecycle.getState());
onExtensionMessage("getBalance", (message) => reads.getBalance(message.data));
onExtensionMessage("getTokenBalances", (message) => reads.getTokenBalances(message.data));
onExtensionMessage("getActivity", (message) => reads.getActivity(message.data));
onExtensionMessage("getPortfolioHistory", (message) => reads.getPortfolioHistory(message.data));
onExtensionMessage("getTokenPrices", () => reads.getTokenPrices());
onExtensionMessage("getConnectedApps", () => approval.getConnectedApps());

/**
 * `TransferDraft`/`UploadDraft` type `walletId` as optional (see those
 * models' own doc comments: kept optional only to stay structurally
 * compatible with a locked test file predating the field, outside this
 * task's ALLOWED SCOPE to change). Every real caller (`SendView`/
 * `UploadView`) always supplies it, but the wire type itself can't
 * promise that — this guard turns a missing field into a named rejection
 * rather than `undefined` silently reaching the key-session lookup as a
 * wallet id. Signing material itself is no longer carried on the
 * request at all — see `key-session.ts`.
 */
function requireWalletId<T extends { walletId?: string }>(draft: T): T & { walletId: string } {
  if (!draft.walletId) {
    throw new Error("This action requires a wallet id.");
  }
  return draft as T & { walletId: string };
}

// actions
onExtensionMessage("estimateTransfer", (message) => transfer.estimateTransfer(requireWalletId(message.data)));
onExtensionMessage("submitTransfer", (message) => transfer.submitTransfer(requireWalletId(message.data)));
onExtensionMessage("reviewUpload", (message) => upload.reviewUpload(message.data));
onExtensionMessage("submitUpload", (message) => upload.submitUpload(requireWalletId(message.data)));

// approvals
onExtensionMessage("getApproval", (message) => approval.getApproval(message.data));
onExtensionMessage("resolveApproval", (message) => approval.resolveApproval(message.data));

// settings
onExtensionMessage("getNetworkSettings", () => reads.getNetworkSettings());
onExtensionMessage("setNetworkSettings", (message) => storage.set("local:networkSettings", message.data));
onExtensionMessage("getLockSettings", () => lifecycle.getLockSettings());
onExtensionMessage("setLockSettings", (message) => lifecycle.setLockSettings(message.data));
onExtensionMessage("getThemePreference", () => lifecycle.getThemePreference());
onExtensionMessage("setThemePreference", (message) => lifecycle.setThemePreference(message.data));
onExtensionMessage("revokeGrant", async (message) => {
  await approval.revokeGrant(message.data);
  void emitProviderEventToOrigin(message.data.origin, PROVIDER_EVENT.DISCONNECT, {});
});

// The only method a web page can reach, through the content script.
messenger.onMessage("providerCall", (message) => {
  const origin = contentScriptOrigin(message.sender, extensionBaseUrl);
  if (!origin) {
    throw new Error("providerCall is only accepted from a web page's content script.");
  }
  const { method, params } = message.data;
  if (!PROVIDER_METHODS.includes(method as (typeof PROVIDER_METHODS)[number])) {
    throw new Error(`Provider method "${method}" is not reachable from a web page.`);
  }
  if (!PROVIDER_SURFACE_METHODS.includes(method)) {
    throw new Error(`Unknown provider method "${method}".`);
  }
  return (async () =>
    encodeProviderResult(await handleProviderCall(origin, method, decodeProviderParams(params))))();
});

export default defineBackground(() => {
  // Registration above runs at module-evaluation time (matching
  // `@webext-core/messaging`'s own documented pattern: `onMessage` must
  // be called once per JS context, not per `defineBackground` invocation,
  // since MV3 service workers only evaluate this module once per
  // wake-up). `defineBackground`'s callback body intentionally does
  // nothing further — it exists so WXT recognizes this file as the
  // background entrypoint and bundles/registers it in the manifest.
});
