import { RiskNotice } from "../../primitives/risk-notice";
import { MemorableAddress } from "./MemorableAddress";

export interface RecipientWarningProps {
  firstTime: boolean;
  /** The known address the recipient imitates, if any. Takes precedence over `firstTime`. */
  lookalikeOf?: string | null;
  /** The known address's avatar, so its picture can be set against the recipient's. */
  lookalikeAvatarSvg?: string;
  emphasisPick?: number | null;
  className?: string;
}

/**
 * Informs, never blocks. A lookalike is the stronger warning: it names the
 * address it resembles, in full, so the two can be compared.
 */
export function RecipientWarning({
  firstTime,
  lookalikeOf,
  lookalikeAvatarSvg,
  emphasisPick = null,
  className,
}: RecipientWarningProps) {
  if (lookalikeOf) {
    return (
      <RiskNotice className={className}>
        <span className="flex min-w-0 flex-col gap-2">
          <span>
            <strong className="font-bold">This address looks like one you know, but it isn&apos;t.</strong> It starts
            and ends the same as this one. Scammers copy the edges of an address you used. Compare every character.
          </span>
          {lookalikeAvatarSvg ? (
            <MemorableAddress address={lookalikeOf} emphasisPick={emphasisPick} avatarSvg={lookalikeAvatarSvg} />
          ) : (
            <span className="break-all font-mono">{lookalikeOf}</span>
          )}
        </span>
      </RiskNotice>
    );
  }
  if (firstTime) {
    return (
      <RiskNotice className={className}>
        <strong className="font-bold">You haven&apos;t sent to this address before.</strong> Double-check it&apos;s
        correct. This can&apos;t be undone once signed.
      </RiskNotice>
    );
  }
  return null;
}
