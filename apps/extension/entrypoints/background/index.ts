import { defineExtensionMessaging } from "@webext-core/messaging";
import { defineBackground } from "wxt/utils/define-background";
import { PERMISSION_TYPES, PROVIDER_METHODS, type PermissionType } from "@gleam/core";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import { PROVIDER_SURFACE_METHODS, type ProviderSurfaceMethod } from "@gleam/messaging/src/page-protocol.ts";
import { WxtStoragePort } from "@/src/adapters/storage";
import { WxtWindowPort } from "@/src/adapters/windows";
import { WalletLifecycleHandler } from "@/src/handlers/wallet-lifecycle";
import { ReadsHandler } from "@/src/handlers/reads";
import { TransferHandler } from "@/src/handlers/transfer";
import { UploadHandler } from "@/src/handlers/upload";
import { ApprovalHandler, decodeBase64Payload } from "@/src/handlers/approval";

/**
 * The background service-worker entrypoint (this task's debt #1, and the
 * single most safety-critical file in this layer): constructs the real
 * adapters, constructs every handler class against them, and registers
 * every `ProtocolMap` method to its handler — the wiring that has never
 * existed before this task, even though every handler it wires
 * (`WalletLifecycleHandler`/`ReadsHandler`/`TransferHandler`/
 * `UploadHandler`) was already built and tested by earlier layers.
 *
 * Privilege-tier enforcement (this task's highest-stakes rule, per
 * ARCHITECTURE.md §4.2): a page can only ever reach a `ProtocolMap`
 * method by routing through `providerCall` (`protocol.ts`'s own doc
 * comment on that method explains why no other entry point exists for
 * the 19-method provider surface). This file is the one and only place
 * `providerCall`'s handler validates the requested provider-surface
 * method against `PROVIDER_METHODS` before doing anything else with
 * it — the single choke point. `APPROVAL_METHODS`
 * (`getApproval`/`resolveApproval`) and
 * `KEY_METHODS` (`createWallet`/`importWallet`/`exportWallet`) are never
 * routed through `providerCall` at all; they're registered as their own
 * ordinary `onMessage` handlers, reachable only by whichever context
 * calls `sendMessage` for that exact method name directly (the approval
 * window for the former, the popup/sidepanel for the latter) — a
 * content-script relay has no way to invoke them except by going through
 * `providerCall`, which rejects every method not in `PROVIDER_METHODS`.
 * This mirrors `PROVIDER_METHODS`/`APPROVAL_METHODS`/`KEY_METHODS` being
 * pairwise disjoint (already unit-tested by `messaging`): there is no
 * method name that is simultaneously provider-reachable and
 * key/approval-reachable, so gating only `providerCall`'s single method
 * argument is sufficient to keep a page out of the other two tiers
 * entirely — a page cannot call `sendMessage("createWallet", ...)`
 * itself in the first place, since it has no `@webext-core/messaging`
 * messenger of its own; only the content script (which only ever calls
 * `providerCall`) and trusted extension pages have one.
 */
const messenger = defineExtensionMessaging<ProtocolMap>();

const storage = new WxtStoragePort();
const windows = new WxtWindowPort();

const lifecycle = new WalletLifecycleHandler(storage);
const reads = new ReadsHandler(storage);
const transfer = new TransferHandler(storage);
const upload = new UploadHandler(storage);
const approval = new ApprovalHandler(storage, windows);

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
  params: unknown,
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
    return result;
  }

  if (method === "disconnect") {
    await approval.revokeGrant({ origin });
    return undefined;
  }

  const grant = await approval.findActiveGrant(origin);
  if (!grant) {
    throw new Error(`"${origin}" is not connected. Call connect() first.`);
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
    case "dispatch":
    case "signDataItem":
    case "batchSignDataItem": {
      const signingParams = params as {
        recipient?: string | null;
        amount?: string | null;
        data?: string;
        tags?: Array<{ name: string; value: string }>;
      };
      const payload = signingParams.data ? decodeBase64Payload(signingParams.data) : new Uint8Array();
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: grant.walletId,
        recipient: signingParams.recipient ?? null,
        amount: signingParams.amount ?? null,
        fee: null,
        payload,
        tags: signingParams.tags ?? [],
      });
    }

    case "encrypt":
    case "decrypt": {
      const cryptoParams = params as { data?: string };
      const payload = cryptoParams.data ? decodeBase64Payload(cryptoParams.data) : new Uint8Array();
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: grant.walletId,
        payload,
      });
    }

    case "signature":
    case "signMessage":
    case "privateHash":
    case "verifyMessage":
      // `ApprovalKind` (`core/models/approval.ts`, locked outside this
      // task's ALLOWED SCOPE) has no case for these four
      // `PROVIDER_SURFACE_METHODS` — only `sign`/`dispatch`/
      // `signDataItem`/`batchSignDataItem`/`encrypt`/`decrypt` are
      // representable as an approval preview today. Named, honest
      // failure rather than force-fitting one of those kinds onto a
      // request it doesn't describe. See this task's final report.
      throw new Error(`Provider method "${method}" is not implemented yet.`);

    default: {
      const exhaustiveCheck: never = method;
      throw new Error(`Unhandled provider method "${String(exhaustiveCheck)}".`);
    }
  }
}

// wallet lifecycle — KEY_METHODS among these (createWallet/importWallet/
// exportWallet) are never reachable through `providerCall`; see this
// file's own doc comment for why gating `providerCall` alone suffices.
messenger.onMessage("createWallet", (message) => lifecycle.createWallet(message.data));
messenger.onMessage("importWallet", (message) => lifecycle.importWallet(message.data));
messenger.onMessage("deleteWallet", (message) => lifecycle.deleteWallet(message.data));
messenger.onMessage("renameWallet", (message) => lifecycle.renameWallet(message.data));
messenger.onMessage("switchWallet", (message) => lifecycle.switchWallet(message.data));
messenger.onMessage("exportWallet", (message) => lifecycle.exportWallet(message.data));
messenger.onMessage("lockWallet", () => lifecycle.lockWallet());
messenger.onMessage("unlockWallet", (message) => lifecycle.unlockWallet(message.data));

// reads
messenger.onMessage("getState", () => lifecycle.getState());
messenger.onMessage("getBalance", (message) => reads.getBalance(message.data));
messenger.onMessage("getTokenBalances", (message) => reads.getTokenBalances(message.data));
messenger.onMessage("getActivity", (message) => reads.getActivity(message.data));
messenger.onMessage("getPortfolioHistory", (message) => reads.getPortfolioHistory(message.data));
messenger.onMessage("getConnectedApps", () => approval.getConnectedApps());

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
messenger.onMessage("estimateTransfer", (message) => transfer.estimateTransfer(requireWalletId(message.data)));
messenger.onMessage("submitTransfer", (message) => transfer.submitTransfer(requireWalletId(message.data)));
messenger.onMessage("reviewUpload", (message) => upload.reviewUpload(message.data));
messenger.onMessage("submitUpload", (message) => upload.submitUpload(requireWalletId(message.data)));

// approvals — APPROVAL_METHODS, reachable only from the approval window
// (nothing prevents another trusted extension surface from calling these
// directly today, since `@webext-core/messaging` has no per-sender ACL
// primitive; see this task's final report for that residual gap).
messenger.onMessage("getApproval", (message) => approval.getApproval(message.data));
messenger.onMessage("resolveApproval", (message) => approval.resolveApproval(message.data));

// settings
messenger.onMessage("getNetworkSettings", () => reads.getNetworkSettings());
messenger.onMessage("setNetworkSettings", (message) => storage.set("local:networkSettings", message.data));
messenger.onMessage("getLockSettings", () => lifecycle.getLockSettings());
messenger.onMessage("setLockSettings", (message) => lifecycle.setLockSettings(message.data));
messenger.onMessage("getThemePreference", () => lifecycle.getThemePreference());
messenger.onMessage("setThemePreference", (message) => lifecycle.setThemePreference(message.data));
messenger.onMessage("revokeGrant", (message) => approval.revokeGrant(message.data));

// the single provider-surface choke point (this task's debt #1)
messenger.onMessage("providerCall", (message) => {
  if (!PROVIDER_METHODS.includes(message.data.method as (typeof PROVIDER_METHODS)[number])) {
    throw new Error(
      `Provider method "${message.data.method}" is not reachable from a web page.`,
    );
  }
  if (!PROVIDER_SURFACE_METHODS.includes(message.data.method)) {
    throw new Error(`Unknown provider method "${message.data.method}".`);
  }
  return handleProviderCall(message.data.origin, message.data.method, message.data.params);
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
