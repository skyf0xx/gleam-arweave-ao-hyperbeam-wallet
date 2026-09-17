import type {
  TokenBalanceRequest,
  TokenBalanceResult,
  UserTokensOptions,
  UserTokensResult,
} from "@gleam/core";

/**
 * `tokenBalance`/`userTokens`' wire-level request/response shapes — plain
 * read-only query/response types, unlike `signing-protocol.ts`'s contracts,
 * since neither carries any binary field that needs `TaggedArrayBuffer`
 * encoding across the `postMessage` boundary.
 *
 * Both are relayed through `ProtocolMap.providerCall` (`protocol.ts`)
 * exactly like every other provider-surface method, following
 * `transferAoTokens`'s existing precedent — neither gets its own
 * `ProtocolMap` entry. This file exists so a later `provider-bridge`
 * layer's dispatcher has a name for each method's concrete wire-request/
 * response pairing to narrow `providerCall`'s `unknown` params/return
 * against, the same role `SigningWireContract` plays for the 10 signing
 * methods.
 *
 * Per this task's RELEVANT RULES, `tokenBalance`/`userTokens` are
 * READ-ONLY: they require only the existing connection-approval (Grant)
 * check for the calling origin, never the signing-approval window — so,
 * unlike `SigningWireContract`'s methods, neither request shape here needs
 * an approval-window payload of any kind. Enforcing that check at the
 * dispatcher choke point is `provider-bridge`'s job; this layer only pins
 * the wire shape.
 */
export type WireTokenBalanceRequest = TokenBalanceRequest;
export type WireTokenBalanceResult = TokenBalanceResult;

export type WireUserTokensRequest = UserTokensOptions;
export type WireUserTokensResult = UserTokensResult;

/**
 * Maps each read-only token-query `ProviderSurfaceMethod` to its wire
 * request/result pair — the lookup a later `provider-bridge` dispatcher
 * narrows `providerCall`'s `params: unknown`/`unknown` return against for
 * these 2 methods specifically, the same role `SigningWireContract` plays
 * for the signing methods.
 */
export interface TokenWireContract {
  tokenBalance: {
    request: WireTokenBalanceRequest;
    result: WireTokenBalanceResult;
  };
  userTokens: {
    request: WireUserTokensRequest;
    result: WireUserTokensResult;
  };
}
