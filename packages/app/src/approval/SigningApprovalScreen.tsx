import { useState } from "react";
import { WALLET_APPROVAL_ORIGIN, type RecipientAssessment, type SigningApprovalPreview } from "@gleam/core";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { CollectibleThumbnail, MemorableAddress, RecipientCard, RecipientWarning } from "@gleam/ui/src/components/wallet/index.ts";
import { useAddressIdentity } from "../address-identity";
import { formatAtomicAsDisplay, formatWinstonAsAr } from "../screens/main-screen/src/formatWinston";

/**
 * The highest-stakes screen in the product: recipient, amount, fee, a
 * decoded-data preview, tags, and a SHA-256 hash of the exact signing
 * payload with its own copy affordance, all shown before signing is
 * possible. Full addresses only, never truncated: addresses render in
 * `MemorableAddress`'s chunked form with their avatar. Never uses the beam as anything
 * but the small identity mark, and never uses humor here — maximum
 * clarity, zero cleverness. The irreversible-tier `RecipientWarning`/
 * `destructive` Button pairing is the same one `RiskNotice`'s own doc
 * comment names as this screen's reason for existing as a single shared
 * component.
 */
export interface SigningApprovalScreenProps {
  origin: string;
  preview: SigningApprovalPreview;
  /** Recipient checks for a transfer; omitted or null shows none. */
  assessment?: RecipientAssessment | null;
  onReject: () => void;
  /** Rejects (surfacing its message inline) if signing fails — e.g. the wallet's unlocked session has since expired. */
  onSign: () => Promise<void>;
}

const REQUEST_KIND_COPY: Record<SigningApprovalPreview["kind"], string> = {
  sign: "Sign and send",
  dispatch: "Sign and send",
  signDataItem: "Sign message",
  batchSignDataItem: "Sign messages",
  encrypt: "Encrypt data",
  decrypt: "Decrypt data",
  transferAoTokens: "Send",
  signMessage: "Sign message",
  transfer: "Send",
  pointsProof: "Prove ownership",
};

function actionCopy(preview: SigningApprovalPreview): string {
  if (preview.kind === "batchSignDataItem" && preview.items) {
    return `${REQUEST_KIND_COPY[preview.kind]} (${preview.items.length})`;
  }
  return REQUEST_KIND_COPY[preview.kind];
}

/**
 * Token identity shown alongside the amount for a `transferAoTokens`
 * preview. No token-symbol lookup exists in this layer's scope, so this
 * renders the raw AO processId truncated to a short recognizable form
 * rather than fabricating a symbol.
 */
function shortenProcessId(processId: string): string {
  return truncateAddress(processId, 6);
}

/**
 * `preview.amount`/`preview.fee` are atomic-integer strings (Winston for
 * the native AR token, `preview.token`'s own smallest unit otherwise —
 * see `SigningApprovalPreview.token`'s doc comment). `fee` is always AR
 * (an AO transfer has no sender-side fee — `core/ao/transfer.ts`'s
 * `AO_TRANSFER_HAS_NO_FEE`), so it's formatted with `formatWinstonAsAr`
 * regardless of what `token` the amount itself is denominated in.
 *
 * An AO amount's `tokenDenomination` comes from the same balance-metadata
 * read the token list uses (`ReadsHandler.previewWatchedToken`), resolved
 * by the background before the approval window opens. That read is best-
 * effort and never blocks the approval — when it's `null` (lookup failed,
 * or hasn't happened for this token), the raw atomic integer is shown
 * as-is; `formatAmountUnit` below labels it "smallest units" so it doesn't
 * read as a scaled amount.
 */
function formatAmount(atomic: string | null, token: string | null, tokenDenomination: number | null): string {
  if (atomic === null) return "—";
  if (token === null) return formatWinstonAsAr(atomic, 12);
  return tokenDenomination === null ? atomic : formatAtomicAsDisplay(atomic, tokenDenomination, tokenDenomination);
}

/**
 * Companion to `formatAmount`: the unit label shown under an AO transfer's
 * amount. Prefers the resolved ticker; falls back to a shortened process id
 * when no ticker resolved, or when the "ticker" is just the process id
 * echoed back (`TokenBalance.ticker` defaults to `processId` when unresolved
 * — see `withRegisteredTicker`/`withUnregisteredMetadata` in `reads.ts`).
 * Falls back further to "smallest units" whenever the denomination itself
 * is unknown, since a ticker with no confirmed scale is misleading on its
 * own (is this 1000 units, or 0.000001?).
 */
function formatAmountUnit(token: string | null, tokenDenomination: number | null, tokenTicker: string | null): string | null {
  if (token === null) return null;
  if (tokenDenomination === null) return "smallest units";
  if (tokenTicker !== null && tokenTicker !== token) return tokenTicker;
  return shortenProcessId(token);
}

function formatFee(fee: string | null): string {
  return fee === null ? "—" : formatWinstonAsAr(fee, 12);
}

/**
 * AR-denominated Total (amount + fee), shown next to the raw amount for a
 * `sign`/`dispatch` preview so the review screen never implies the fee is
 * separate from what leaves the wallet. `null` for anything not
 * AR-denominated (`transferAoTokens`'s fee is always `null`).
 */
function formatTotal(
  amount: string | null,
  fee: string | null,
  token: string | null,
  tokenDenomination: number | null,
): string {
  if (token !== null || amount === null || fee === null) return formatAmount(amount, token, tokenDenomination);
  try {
    return formatWinstonAsAr((BigInt(amount) + BigInt(fee)).toString(), 12);
  } catch {
    return "—";
  }
}

function hostnameOf(origin: string): string {
  if (origin === WALLET_APPROVAL_ORIGIN) return "Gleam";
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard access can be denied by the browser — the value is still
    // fully visible and selectable on screen, so this is a soft failure.
  }
}

export function SigningApprovalScreen({
  origin,
  preview,
  assessment,
  onReject,
  onSign,
}: SigningApprovalScreenProps) {
  const lookalikeOf = assessment?.lookalikeOf ?? null;
  const identity = useAddressIdentity();
  const { emphasisPick } = identity;
  const lookalikeAvatarSvg = lookalikeOf ? identity.avatarSvg(lookalikeOf) : undefined;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const isTransfer = preview.recipient !== null;
  const irreversible = isTransfer; // first-seen/unlimited tiering happens upstream in the dispatcher's preview construction.

  const handleSign = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onSign();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md border border-line bg-mist text-[10px] font-bold text-muted">
          {hostnameOf(origin).charAt(0).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-caption font-semibold text-foreground">{hostnameOf(origin)}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4.5">
        <div className="text-center text-body font-bold text-foreground">{actionCopy(preview)}</div>

        {preview.kind === "pointsProof" ? (
          <p className="text-center text-label leading-relaxed text-muted">
            To use Gleam Points, your device signs a 0 AR transaction that proves you own this wallet. It is never
            posted and moves no AR.
          </p>
        ) : null}

        {isTransfer && preview.collectible ? (
          <>
            <div className="flex flex-col items-center gap-2 py-1 text-center">
              <CollectibleThumbnail
                name={preview.collectible.name ?? "Collectible"}
                imageUrl={preview.collectible.imageUrl}
                className="w-24"
              />
              <span className="break-words text-body font-semibold text-foreground">
                {preview.collectible.name ?? truncateAddress(preview.collectible.id, 6)}
              </span>
            </div>

            <RecipientWarning
              firstTime={assessment?.firstTime ?? false}
              lookalikeOf={lookalikeOf}
              lookalikeAvatarSvg={lookalikeAvatarSvg}
              emphasisPick={emphasisPick}
            />

            <RecipientBlock address={preview.recipient ?? ""} />

            <div className="flex flex-col">
              <ReviewRow label="Network fee" value={preview.fee === null ? "—" : `${formatWinstonAsAr(preview.fee, 12)} AR`} />
            </div>
          </>
        ) : isTransfer ? (
          <>
            <div className="flex flex-col items-center gap-1 py-1 text-center">
              <span className="text-[28px] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
                {formatAmount(preview.amount, preview.token, preview.tokenDenomination)}
              </span>
              {preview.token != null ? (
                <span className="text-caption font-semibold uppercase tracking-wide text-muted">
                  {formatAmountUnit(preview.token, preview.tokenDenomination, preview.tokenTicker)}
                </span>
              ) : null}
            </div>

            <RecipientWarning
              firstTime={assessment?.firstTime ?? false}
              lookalikeOf={lookalikeOf}
              lookalikeAvatarSvg={lookalikeAvatarSvg}
              emphasisPick={emphasisPick}
            />

            <RecipientBlock address={preview.recipient ?? ""} />

            <div className="flex flex-col">
              <ReviewRow label="Fee" value={formatFee(preview.fee)} />
              <ReviewRow
                label="Total"
                value={formatTotal(preview.amount, preview.fee, preview.token, preview.tokenDenomination)}
                strong
              />
            </div>
          </>
        ) : null}

        {preview.items ? (
          <div className="flex flex-col gap-3">
            <span className="text-caption font-semibold uppercase tracking-wide text-muted">
              {preview.items.length} item{preview.items.length === 1 ? "" : "s"} to sign
            </span>
            {preview.items.map((item, index) => (
              <DataItemPreview key={index} index={index} item={item} />
            ))}
          </div>
        ) : (
          <>
            {preview.decodedData !== null && preview.decodedData !== "" ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-caption font-semibold uppercase tracking-wide text-muted">Decoded data</span>
                <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-mist p-3 font-mono text-caption leading-relaxed text-foreground">
                  {preview.decodedData}
                </div>
              </div>
            ) : null}

            {preview.tags.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-caption font-semibold uppercase tracking-wide text-muted">Tags</span>
                <div className="flex flex-wrap gap-1.5">
                  {preview.tags.map((tag, index) => (
                    <span key={index} className="rounded-md bg-mist px-2 py-1 font-mono text-[10px] text-foreground">
                      <span className="text-muted">{tag.name}:</span> {tag.value}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* A wallet send has no payload of its own; its device step shows what is signed. */}
            {preview.kind !== "transfer" ? (
              <AddrBlock label="Signing payload (SHA-256)" value={preview.payloadHash} />
            ) : null}
          </>
        )}

        {error ? (
          <div role="alert" className="text-caption leading-snug text-warning">
            {error}
          </div>
        ) : null}

        <div className="mt-auto flex gap-2.5 pt-1">
          <Button type="button" variant="secondary" onClick={onReject} className="flex-1">
            Reject
          </Button>
          <Button
            type="button"
            variant={irreversible ? "destructive" : "primary"}
            disabled={submitting}
            aria-busy={submitting}
            onClick={() => void handleSign()}
            className="flex-1"
          >
            {submitting ? "Signing…" : actionCopy(preview)}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DataItemPreview({
  index,
  item,
}: {
  index: number;
  item: NonNullable<SigningApprovalPreview["items"]>[number];
}) {
  const identity = useAddressIdentity();
  const { emphasisPick } = identity;
  const targetAvatarSvg = item.target ? identity.avatarSvg(item.target) : undefined;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-3">
      <span className="text-caption font-semibold text-foreground">Item {index + 1}</span>

      {item.target !== null ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">Target</span>
          <MemorableAddress address={item.target} emphasisPick={emphasisPick} avatarSvg={targetAvatarSvg} />
        </div>
      ) : null}

      {item.decodedData !== null && item.decodedData !== "" ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">Decoded data</span>
          <div className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-mist p-2 font-mono text-[11px] leading-relaxed text-foreground">
            {item.decodedData}
          </div>
        </div>
      ) : null}

      {item.tags.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag, tagIndex) => (
              <span key={tagIndex} className="rounded-md bg-mist px-2 py-1 font-mono text-[10px] text-foreground">
                <span className="text-muted">{tag.name}:</span> {tag.value}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-0.5">
        <span className="text-caption font-semibold uppercase tracking-wide text-muted">Payload (SHA-256)</span>
        <span className="break-all font-mono text-[11px] text-foreground">{item.payloadHash}</span>
      </div>
    </div>
  );
}

function RecipientBlock({ address }: { address: string }) {
  const identity = useAddressIdentity();
  const { emphasisPick } = identity;
  const avatarSvg = identity.avatarSvg(address);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-caption font-semibold uppercase tracking-wide text-muted">Recipient</span>
        <button
          type="button"
          aria-label="Copy recipient"
          onClick={() => void copyToClipboard(address)}
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-mist hover:text-muted"
        >
          <CopyIcon />
        </button>
      </div>
      <RecipientCard address={address} avatarSvg={avatarSvg} emphasisPick={emphasisPick} tone="confirm" />
    </div>
  );
}

function AddrBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex items-start gap-2 rounded-md border border-line bg-background p-3">
        <span className="flex-1 break-all font-mono text-caption leading-relaxed text-foreground">{value}</span>
        <button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void copyToClipboard(value)}
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-mist hover:text-muted"
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-label last:border-b-0 last:border-t last:pt-3">
      <span className="text-muted">{label}</span>
      <span className={`text-right tabular-nums text-foreground ${strong ? "font-bold" : "font-semibold"}`}>
        {value}
      </span>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
