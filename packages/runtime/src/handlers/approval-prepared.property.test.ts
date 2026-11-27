import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { base64UrlToBytes, bytesToBase64Url, readDataItemFields, type SigningApprovalPreview, type UnsignedPayload } from "@gleam/core";
import { InMemoryStorage } from "../../testing";
import { PAGE_METHODS, parseParams } from "../dispatch/methods";
import { ApprovalHandler } from "./approval";
import { assertPreparedMatches } from "./approval-prepared";
import { buildSigningPreview, previewCollectibleId } from "./approval-preview";
import type { SigningRequestInput } from "./approval-types";
import { decodeTransactionTag, summarize } from "./prepared-check";
import { createProviderHandlers, type GrantedCall, type ProviderDeps, type TokenPreview } from "./provider";
import { address, hasLoneSurrogate, pageText, signingTags, text, winston } from "./signing-arbitraries.testing";

/*
 * What the approval window shows and what the signer signs, end to end: a
 * page's request goes through the dispatcher's parser and the provider
 * handler to the approval input, which builds both the preview and the
 * prepared bytes. Every field the preview names must be what the bytes
 * say, as the device step (`summarize`) reads them back.
 *
 * The bytes are read back with the production decoders (`readDataItemFields`,
 * `decodeTransactionTag`, `summarize`) by design: the device step and
 * `assertPreparedMatches` read them that way, so agreeing with them is the
 * claim. The decoders themselves are checked against arweave-js and
 * arbundles in core's property tests.
 *
 * A lone surrogate in string `data` isn't singled out: `readDataItem`
 * encodes the string to UTF-8 bytes once, before the preview, and the
 * preview, its hash and the signer all use those same bytes. A tag stays a
 * string until the item is built, which is why only tags can diverge.
 */

const GATEWAY = "https://arweave.net";
const OWNER = bytesToBase64Url(new Uint8Array(512).map((_, index) => (index * 31 + 7) % 256));
const WALLET = { id: "wallet-1", address: "a".repeat(43), method: "jwk" } as NonNullable<GrantedCall["wallet"]>;

// Every request carries its reward and anchor, so nothing may reach a gateway.
let fetches = 0;
beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    fetches += 1;
    return Promise.reject(new Error("no network in this test"));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  expect(fetches).toBe(0);
});

function handlersWith(tokenPreview: TokenPreview) {
  const unused = () => {
    throw new Error("not used by signing requests");
  };
  const deps = {
    lifecycle: { getState: unused },
    reads: {
      getNetworkSettings: async () => ({ gatewayUrl: GATEWAY, peers: [], activePeerUrl: null }),
      getBalance: unused,
      tokenBalance: unused,
      userTokens: unused,
      isTokenAdded: unused,
      previewWatchedToken: unused,
    },
    siteWallet: { setUseGleam: unused },
    grants: { findActiveGrant: unused, revokeGrant: unused },
    favIconFor: unused,
    readableActiveAddress: unused,
    emitProviderEventToOrigin: unused,
    pushSiteWalletMode: unused,
    resolveTokenPreview: async () => tokenPreview,
    quoteTokenTransferFee: unused,
  } as unknown as ProviderDeps;
  return createProviderHandlers(deps);
}

/** The approval input a provider handler builds for a page's request. */
async function approvalInputFor(
  method: "sign" | "dispatch" | "signDataItem" | "batchSignDataItem",
  params: unknown,
  tokenPreview: TokenPreview,
): Promise<SigningRequestInput> {
  let captured: SigningRequestInput | undefined;
  const call = {
    origin: "https://dapp.example",
    wallet: WALLET,
    activeWalletId: () => WALLET.id,
    requestApproval: async (input: SigningRequestInput) => {
      captured = input;
    },
  } as unknown as GrantedCall & { requestApproval: never };
  const handlers = handlersWith(tokenPreview);
  // Each method's own parser, as the dispatcher runs it.
  const parsed = parseParams(PAGE_METHODS[method].params, params) as never;
  await handlers[method](parsed, call);
  return captured!;
}

const approvals = new ApprovalHandler(
  new InMemoryStorage(),
  {} as ConstructorParameters<typeof ApprovalHandler>[1],
  { present: async () => {}, focus: async () => {}, dismiss: async () => {}, onDismissed: () => () => {} },
);

/** What the approval handler prepares for a keyfile wallet: its own private `prepareDappPayloads`, called as signing calls it. */
function prepare(input: SigningRequestInput): Promise<UnsignedPayload[]> {
  return approvals["prepareDappPayloads"](OWNER, "jwk", input);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const utf8Base64Url = (value: string) => bytesToBase64Url(new TextEncoder().encode(value));

const tokenPreview: fc.Arbitrary<TokenPreview> = fc.record({
  tokenDenomination: fc.constantFrom(null, 0, 12),
  tokenTicker: fc.constantFrom(null, "TKN"),
  collectible: fc.oneof({ weight: 2, arbitrary: fc.constant(true) }, fc.constant(false)),
  impersonating: fc.boolean(),
});

/** arweave-js's `Transaction.toJSON()` as a page sends it: data and tags base64url. */
const pageTransaction = fc
  .record({
    // Token transfers and name changes carry no data and 0 or 1 winston, so most requests do.
    data: fc.oneof({ weight: 3, arbitrary: fc.constant(new Uint8Array()) }, fc.uint8Array({ maxLength: 2048 })),
    tags: signingTags(text(40)),
    target: fc.option(address, { nil: undefined }),
    quantity: fc.option(fc.oneof({ weight: 3, arbitrary: fc.constantFrom("0", "1") }, winston), { nil: undefined }),
    reward: fc.bigInt({ min: 1n, max: 10n ** 15n }).map(String),
    last_tx: fc.uint8Array({ minLength: 48, maxLength: 48 }).map(bytesToBase64Url),
  })
  .map(({ data, tags, target, quantity, ...rest }) => ({
    ...rest,
    data: bytesToBase64Url(data),
    tags: tags.map((tag) => ({ name: utf8Base64Url(tag.name), value: utf8Base64Url(tag.value) })),
    target,
    // AR sent to no one is refused before any preview.
    quantity: target ? quantity : undefined,
  }));

const pageDataItem = fc.record(
  {
    data: fc.oneof(fc.uint8Array({ maxLength: 2048 }), pageText(200)),
    tags: signingTags(pageText(40)),
    target: address,
    anchor: fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), minLength: 32, maxLength: 32 }),
  },
  { requiredKeys: ["data", "tags"] },
);

/** The device step reads the same recipient, amount and fee out of the bytes as the preview shows. */
function expectTransactionAgrees(preview: SigningApprovalPreview, payload: UnsignedPayload): string {
  const summary = summarize(payload, previewCollectibleId(preview));
  expectSummaryAgrees(preview, summary);
  return summary.kind;
}

function expectSummaryAgrees(preview: SigningApprovalPreview, summary: ReturnType<typeof summarize>): void {
  switch (summary.kind) {
    case "l1TokenTransfer":
      expect([preview.token, preview.recipient, preview.amount, preview.fee]).toEqual([
        summary.process,
        summary.recipient,
        summary.quantity,
        summary.fee,
      ]);
      return;
    case "collectibleTransfer":
      expect([preview.collectible?.id, preview.recipient, preview.amount, preview.fee]).toEqual([
        summary.asset,
        summary.recipient,
        "1",
        summary.fee,
      ]);
      return;
    case "nameTarget":
      // A dApp's `set` shows as the plain transaction it is; the device
      // folds the winston it carries into the fee. Both move the same AR.
      expect(preview.recipient).toBe(summary.carrier);
      expect(preview.tags).toContainEqual({ name: "reference-value", value: summary.target });
      expect(BigInt(preview.amount!) + BigInt(preview.fee!)).toBe(BigInt(summary.fee));
      return;
    case "transaction":
      expect(preview.recipient).toBe(summary.recipient);
      expect(preview.amount).toBe(summary.recipient === null ? null : summary.quantity);
      expect(preview.fee).toBe(summary.fee);
      expect(preview.token).toBeNull();
      expect(preview.unreadableTokenTransfer ?? false).toBe(summary.unreadableTokenTransfer ?? false);
      return;
    case "dataItem":
      // A bundled dispatch: no fee, and nothing the preview reads as a transfer.
      expect(preview.recipient).toBe(summary.target);
      expect(preview.fee).toBeNull();
      expect(preview.token).toBeNull();
      expect(preview.dataSize).toBe(summary.dataSize);
      return;
    default:
      throw new Error(`a transaction request summarized as ${summary.kind}`);
  }
}

/**
 * Every reading must be reached, so a generator change can't quietly stop
 * testing one. The rarest comes up about 15 times a run (name changes and
 * collectibles per 250 transactions, AO transfers per 400 single items), so
 * a run that misses one is about one in a million.
 */
const count = (seen: Map<string, number>, kind: string) => seen.set(kind, (seen.get(kind) ?? 0) + 1);

const expectReached = (seen: Map<string, number>, kinds: string[]) => {
  for (const kind of kinds) expect(seen.get(kind) ?? 0, kind).toBeGreaterThan(0);
};

const TRANSACTION_READINGS = ["collectibleTransfer", "l1TokenTransfer", "nameTarget", "transaction"];

describe("a sign or dispatch preview names what the prepared bytes say", () => {
  it.each(["sign", "dispatch"] as const)("%s", async (method) => {
    const seen = new Map<string, number>();
    await fc.assert(
      fc.asyncProperty(pageTransaction, tokenPreview, async (transaction, token) => {
        const input = await approvalInputFor(method, { transaction }, token);
        const preview = await buildSigningPreview(input);
        const payloads = await prepare(input);
        assertPreparedMatches(input, payloads, WALLET.address);

        const [payload] = payloads;
        if (payload!.kind === "transaction") {
          const signed = payload!.transaction;
          expect(signed.tags.map(decodeTransactionTag)).toEqual(preview.tags);
          expect(await sha256Hex(base64UrlToBytes(signed.data))).toBe(preview.payloadHash);
          expect(signed.data_size).toBe(String(preview.dataSize));
        } else {
          const fields = readDataItemFields((payload as UnsignedPayload & { kind: "dataItem" }).raw);
          expect(fields.tags).toEqual(preview.tags);
          expect(await sha256Hex(fields.data)).toBe(preview.payloadHash);
        }
        count(seen, expectTransactionAgrees(preview, payload!));
      }),
      { numRuns: 250 },
    );
    // A bundled dispatch is a data item.
    expectReached(seen, [...TRANSACTION_READINGS, ...(method === "dispatch" ? ["dataItem"] : [])]);
  });
});

describe("a data item preview names what each prepared item says", () => {
  it.each(["signDataItem", "batchSignDataItem"] as const)("%s", async (method) => {
    const seen = new Map<string, number>();
    await fc.assert(
      fc.asyncProperty(fc.array(pageDataItem, { minLength: 1, maxLength: 3 }), tokenPreview, async (items, token) => {
        const params = method === "signDataItem" ? { dataItem: items[0] } : { dataItems: items };
        const input = await approvalInputFor(method, params, token);
        const preview = await buildSigningPreview(input);
        const payloads = await prepare(input);
        const signed = method === "signDataItem" ? items.slice(0, 1) : items;
        const malformed = signed.some((item) => item.tags?.some((tag) => hasLoneSurrogate(tag.name) || hasLoneSurrogate(tag.value)));

        // A tag that UTF-8 can't carry would sign as U+FFFD, which the review never showed.
        if (malformed) {
          count(seen, "malformed");
          expect(() => assertPreparedMatches(input, payloads, WALLET.address)).toThrow(/doesn't match the request/);
          return;
        }
        assertPreparedMatches(input, payloads, WALLET.address);

        expect(preview.items).toHaveLength(payloads.length);
        for (const [index, shown] of preview.items!.entries()) {
          const payload = payloads[index]!;
          const fields = readDataItemFields((payload as UnsignedPayload & { kind: "dataItem" }).raw);
          expect(shown.target).toBe(fields.target || null);
          expect(shown.tags).toEqual(fields.tags);
          expect(shown.dataSize).toBe(fields.data.byteLength);
          expect(shown.payloadHash).toBe(await sha256Hex(fields.data));

          const summary = summarize(payload, previewCollectibleId(preview, index));
          count(seen, summary.kind);
          if (shown.transfer?.collectible) {
            expect(summary).toEqual({ kind: "collectibleTransfer", asset: shown.transfer.token, recipient: shown.transfer.recipient, fee: "0" });
          } else if (shown.transfer) {
            expect(summary).toEqual({
              kind: "aoTransfer",
              process: shown.transfer.token,
              recipient: shown.transfer.recipient,
              quantity: shown.transfer.amount,
            });
          } else {
            expect(summary.kind).toBe("dataItem");
            expect(shown.unreadableTokenTransfer ?? false).toBe((summary as { unreadableTokenTransfer?: true }).unreadableTokenTransfer ?? false);
          }
        }
      }),
      { numRuns: 400 },
    );
    expectReached(seen, ["aoTransfer", "collectibleTransfer", "dataItem", "malformed"]);
  });
});
