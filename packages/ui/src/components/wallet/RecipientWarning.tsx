import { RiskNotice } from "../../primitives/risk-notice";

export interface RecipientWarningProps {
  firstTime: boolean;
  /** The known address the recipient imitates, if any. Takes precedence over `firstTime`. */
  lookalikeOf?: string | null;
  className?: string;
}

/**
 * Informs, never blocks. A lookalike is the stronger warning: it names the
 * address it resembles, in full, so the two can be compared.
 */
export function RecipientWarning({ firstTime, lookalikeOf, className }: RecipientWarningProps) {
  if (lookalikeOf) {
    return (
      <RiskNotice className={className}>
        <strong className="font-bold">This address looks like one you know, but it isn&apos;t.</strong> It starts and
        ends the same as <span className="break-all font-mono">{lookalikeOf}</span>. Scammers copy the edges of an
        address you used. Compare every character.
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
