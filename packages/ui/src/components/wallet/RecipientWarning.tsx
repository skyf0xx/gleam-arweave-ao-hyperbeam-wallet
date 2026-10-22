import { RiskNotice } from "../../primitives/risk-notice";
import { MemorableAddress } from "./MemorableAddress";

export interface RecipientWarningProps {
  firstTime: boolean;
  /** The known address the recipient imitates, if any. */
  lookalikeOf?: string | null;
  /** The known address's avatar, so its picture can be set against the recipient's. */
  lookalikeAvatarSvg?: string;
  emphasisPick?: number | null;
  className?: string;
}

/**
 * The one irreversible-send notice: a single headline with every reason
 * that applies listed under it, so a screen never stacks boxes that repeat
 * "cannot be undone". Informs, never blocks. A lookalike leads the list and
 * names the address it resembles, in full, so the two can be compared.
 */
export function RecipientWarning({
  firstTime,
  lookalikeOf,
  lookalikeAvatarSvg,
  emphasisPick = null,
  className,
}: RecipientWarningProps) {
  return (
    <RiskNotice className={className}>
      <strong className="font-bold">This cannot be undone.</strong>
      <ul className="m-0 mt-1.5 flex list-disc flex-col gap-1.5 pl-4">
        {lookalikeOf ? (
          <li>
            <span className="flex min-w-0 flex-col gap-2">
              <span>
                <strong className="font-bold">This address looks familiar, but is different.</strong>
                <br />
                Scammers create lookalike addresses to trick you.
                <br />
                Compare every character before sending.
              </span>
              {lookalikeAvatarSvg ? (
                <MemorableAddress address={lookalikeOf} emphasisPick={emphasisPick} avatarSvg={lookalikeAvatarSvg} />
              ) : (
                <span className="break-all font-mono">{lookalikeOf}</span>
              )}
            </span>
          </li>
        ) : null}
        {firstTime ? <li>You haven&apos;t sent to this address before.</li> : null}
        <li>Double-check the recipient before signing.</li>
      </ul>
    </RiskNotice>
  );
}
