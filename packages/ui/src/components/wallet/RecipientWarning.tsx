import type { ReactNode } from "react";
import { cn } from "../../primitives/cn";
import { RiskNotice } from "../../primitives/risk-notice";
import { AccountAvatar } from "./AccountAvatar";
import { MemorableAddress } from "./MemorableAddress";
import { useUiLabels } from "../../labels";

export interface RecipientWarningProps {
  firstTime: boolean;
  /** The address being sent to; its differences from `lookalikeOf` are marked. */
  recipient?: string;
  /** `caution` swaps the warning red for orange; for a first-time recipient that is the only reason. */
  tone?: "risk" | "caution";
  /** The known address the recipient imitates, if any. */
  lookalikeOf?: string | null;
  /** The known address's avatar, so its picture can be set against the recipient's. */
  lookalikeAvatarSvg?: string;
  emphasisPick?: number | null;
  /** More reasons the send is risky, listed before the closing "double-check" line. */
  extraReasons?: readonly string[];
  /** Notice text; English unless the caller passes its own. */
  labels?: RecipientWarningLabels;
  className?: string;
}

export interface RecipientWarningLabels {
  irreversible: string;
  lookalikeTitle: string;
  lookalikeScammers: string;
  lookalikeLabel: string;
  firstTime: string;
  doubleCheck: string;
}

/**
 * The one irreversible-send notice: a single headline with every reason
 * that applies listed under it, so a screen never stacks boxes that repeat
 * "cannot be undone". Informs, never blocks. A lookalike leads the list and
 * names the address it resembles, in full, so the two can be compared.
 */
export function RecipientWarning({
  firstTime,
  recipient,
  tone = "risk",
  lookalikeOf,
  lookalikeAvatarSvg,
  emphasisPick = null,
  extraReasons = [],
  labels: labelsProp,
  className,
}: RecipientWarningProps) {
  const contextLabels = useUiLabels();
  const labels = labelsProp ?? contextLabels.recipientWarning;
  if (lookalikeOf && tone === "risk") {
    return (
      <RiskNotice icon={false} className={cn("px-3 phone:px-3", className)}>
        <div className="flex min-w-0 flex-col gap-2">
          <strong className="font-bold">{labels.lookalikeTitle}</strong>
          <span>{labels.lookalikeScammers}</span>
          <span className="flex items-center gap-2 pt-1 font-semibold text-positive">
            {lookalikeAvatarSvg ? (
              <span aria-hidden="true" className="shrink-0">
                <AccountAvatar svgMarkup={lookalikeAvatarSvg} label="" size={20} />
              </span>
            ) : null}
            {labels.lookalikeLabel}
          </span>
          <MemorableAddress address={lookalikeOf} emphasisPick={emphasisPick} diffAgainst={recipient} diffTone="positive" />
          {firstTime ? <span>{labels.firstTime}</span> : null}
          {extraReasons.map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
      </RiskNotice>
    );
  }
  const Box = tone === "caution" ? CautionNotice : RiskNotice;
  return (
    <Box className={className}>
      <strong className="font-bold">{labels.irreversible}</strong>
      <ul className="m-0 mt-1.5 flex list-disc flex-col gap-1.5 pl-4">
        {lookalikeOf ? (
          <li>
            <span className="flex min-w-0 flex-col gap-2">
              <span>
                <strong className="font-bold">{labels.lookalikeTitle}</strong>
                <br />
                {labels.lookalikeScammers}
              </span>
              {lookalikeAvatarSvg ? (
                <MemorableAddress address={lookalikeOf} emphasisPick={emphasisPick} avatarSvg={lookalikeAvatarSvg} />
              ) : (
                <span className="break-all font-mono">{lookalikeOf}</span>
              )}
            </span>
          </li>
        ) : null}
        {firstTime ? <li>{labels.firstTime}</li> : null}
        {extraReasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
        <li>{labels.doubleCheck}</li>
      </ul>
    </Box>
  );
}

function CautionNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "rounded-md bg-caution-surface px-3.5 py-3 text-label leading-snug text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
