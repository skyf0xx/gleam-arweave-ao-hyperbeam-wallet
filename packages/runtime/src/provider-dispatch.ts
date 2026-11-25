import {
  REFUSED_PROVIDER_METHODS,
  missingPermissions,
  isWatchWalletMethod,
  providerMethodRefusal,
  type ProviderMethod,
  WATCH_ONLY_CONNECT_REFUSAL,
} from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { isSecureSigningOrigin } from "@gleam/core/src/policy/index.ts";
import { dappError } from "./dapp-error";
import { PAGE_METHODS, parseParams, type PageMethodSpec } from "./dispatch/methods";
import type { ApprovalHandler } from "./handlers/approval";
import type { ProviderHandlers, ApprovalCall, GrantedCall } from "./handlers/provider";
import { decodeProviderParams } from "./handlers/provider-params";
import type { WalletLifecycleHandler } from "./handlers/wallet-lifecycle";

const INSECURE_ORIGIN_ERROR = "Gleam only works with secure (https) sites.";

interface ProviderDispatchDeps {
  lifecycle: Pick<WalletLifecycleHandler, "getState">;
  approval: Pick<ApprovalHandler, "findActiveGrant" | "requestApproval">;
  handlers: ProviderHandlers;
}

/**
 * Routes one `window.arweaveWallet` call by its `PAGE_METHODS` entry. The
 * refusals that don't depend on the origin's grant throw synchronously,
 * so every site gets the same answer and no window opens.
 */
export function createProviderDispatch({ lifecycle, approval, handlers }: ProviderDispatchDeps) {
  function dispatchProviderCall(origin: string, method: string, rawParams: unknown): Promise<unknown> {
    if (Object.hasOwn(REFUSED_PROVIDER_METHODS, method)) {
      throw new Error(REFUSED_PROVIDER_METHODS[method as keyof typeof REFUSED_PROVIDER_METHODS]);
    }
    if (!Object.hasOwn(PAGE_METHODS, method)) {
      throw new Error(dappError(`Provider method "${method}" is not reachable from a web page.`));
    }
    const providerMethod = method as ProviderMethod;
    // Checked on every call, not only at connect, so a plain-http origin
    // still holding an older grant can neither sign nor read addresses.
    // `disconnect` only drops the grant, so such a site may still clear it.
    if (providerMethod !== "disconnect" && !isSecureSigningOrigin(origin)) {
      throw new Error(INSECURE_ORIGIN_ERROR);
    }
    return runProviderMethod(origin, providerMethod, rawParams);
  }

  async function runProviderMethod(origin: string, method: ProviderMethod, rawParams: unknown): Promise<unknown> {
    const spec: PageMethodSpec = PAGE_METHODS[method];
    const handle = handlers[method] as (
      params: unknown,
      call: (GrantedCall | { origin: string }) & Partial<ApprovalCall>,
    ) => Promise<unknown>;
    const approvals: Partial<ApprovalCall> = spec.approval
      ? { requestApproval: (request) => approval.requestApproval(request) }
      : {};
    if (!spec.grant) return handle(parseParams(spec.params, decodeProviderParams(rawParams)), { origin, ...approvals });

    const grant = await approval.findActiveGrant(origin);
    if (!grant) {
      throw new Error(dappError(`"${origin}" is not connected. Call connect() first.`));
    }
    const missing = missingPermissions(method, grant.permissions);
    if (missing.length > 0) {
      throw new Error(dappError(`Missing permission(s) for "${method}": ${missing.join(", ")}`));
    }

    const state = await lifecycle.getState();
    const wallet = state.wallets.find((candidate) => candidate.id === state.activeWalletId) ?? null;
    // Grants follow the active wallet, so a site connected earlier must not
    // reach a watch wallet's address or sign requests through its grant.
    if (wallet && isWatchWalletMethod(wallet.method)) throw new Error(WATCH_ONLY_CONNECT_REFUSAL);
    // Refuse what the active wallet can't do before any approval window
    // opens, rather than after the user has approved it.
    const refusal = wallet ? providerMethodRefusal(wallet.method, method) : null;
    if (refusal) throw new Error(refusal);

    // Decoded only now: a page without a grant could otherwise keep the
    // worker busy decoding a large payload it is about to be refused.
    const params = parseParams(spec.params, decodeProviderParams(rawParams));
    const result = await handle(params, {
      ...approvals,
      origin,
      grant,
      state,
      wallet,
      activeWalletId: () => {
        if (!wallet) throw new Error(userErrorMessage("noActiveWalletSign"));
        return wallet.id;
      },
    });
    // A read can wait seconds on the network. A site revoked meanwhile gets
    // nothing; an approval's result is held back by `withheldIfLapsed`.
    if (!spec.approval) await requireGrantStill(origin, method);
    return result;
  }

  async function requireGrantStill(origin: string, method: ProviderMethod): Promise<void> {
    const grant = await approval.findActiveGrant(origin);
    if (!grant || missingPermissions(method, grant.permissions).length > 0) {
      throw new Error(dappError(`"${origin}" is not connected. Call connect() first.`));
    }
  }

  return dispatchProviderCall;
}
