import { useState, type ReactNode } from "react";
import {
  capabilitiesFor,
  capabilityRefusal,
  INVITE_REQUIRED_MESSAGE,
  isHardwareWalletMethod,
  type RuntimePort,
  type WalletSummary,
} from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { useT } from "../../../i18n";
import { inviteLinkFor, invitesRemainingLine } from "../../../points-share";
import { FoundingGate } from "../../onboarding/src/FoundingGate";
import { AboutPoints } from "./AboutPoints";
import { DeviceApprovalNote } from "./DeviceApprovalNote";
import { ACTION_ICON, ACTION_LINK, EarnItem, ReviewItem } from "./EarnItems";
import { JoinNote } from "./JoinNote";
import { LeaveControl } from "./LeaveControl";
import { RecentEarnings } from "./RecentEarnings";
import { useSharePrompt } from "./SharePrompt";
import { Standing } from "./Standing";
import { formatPoints } from "./formatPoints";
import { useCopy } from "@gleam/ui/src/primitives/use-copy.ts";
import { useCountUp } from "./useCountUp";
import { useFlash } from "./useFlash";
import {
  useJoinPoints,
  usePendingInvite,
  usePointsStanding,
} from "./usePoints";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { errorText } from "../../../i18n/errors";
import { CheckIcon, CopyIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";

export interface PointsViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
}

/** What a referrer earns on each referee's base points (POINTS.md § Rules). */
const REFERRAL_PERCENT = 10;

export function PointsView({ runtime, wallet, onBack }: PointsViewProps) {
  const t = useT();
  const standing = usePointsStanding(runtime, wallet);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("points.title")} onBack={onBack} />
      {standing.status === "joined" ? (
        <JoinedView runtime={runtime} wallet={wallet} standing={standing} />
      ) : standing.status === "not-joined" ? (
        <JoinView runtime={runtime} wallet={wallet} />
      ) : null}
    </div>
  );
}

/** The ink panel the site's Points pages are built on, with the beam along its top. */
function InkCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-4 rounded-lg bg-ink px-5 pb-5 pt-4 text-on-ink"
    >
      <Beam className="w-12" />
      {children}
    </section>
  );
}

function JoinView({
  runtime,
  wallet,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
}) {
  const t = useT();
  const join = useJoinPoints(runtime);
  const pending = usePendingInvite(runtime);
  const [typed, setTyped] = useState<string | null>(null);
  const inviteCode = typed ?? pending.data ?? "";
  const canJoin = capabilitiesFor(wallet.method).points;

  if (join.error instanceof Error && join.error.message === INVITE_REQUIRED_MESSAGE) {
    return (
      <FoundingGate
        runtime={runtime}
        initialUnlock={null}
        onUnlocked={() => join.mutate({ walletId: wallet.id })}
      />
    );
  }

  return (
    <form
      className="flex flex-1 flex-col gap-5 px-6 phone:px-5 pb-6 phone:pb-0 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        join.mutate({
          walletId: wallet.id,
          inviteCode: inviteCode.trim() || undefined,
        });
      }}
    >
      <InkCard label={t("points.whatAre")}>
        <p className="text-h3 font-semibold tracking-tight">
          {t("points.earnDaily")}
        </p>
        <p className="text-label text-on-ink-muted">
          {t("points.earnDailyDetail")}
        </p>
      </InkCard>

      <TextField
        label={t("points.inviteCode")}
        placeholder={t("points.inviteCodePlaceholder")}
        value={inviteCode}
        onChange={(event) => setTyped(event.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={16}
        disabled={!canJoin}
        errorMessage={
          join.error ? errorText(join.error) : undefined
        }
      />

      <ScreenFooter className="phone:order-last">
        <Button type="submit" disabled={!canJoin || join.isPending}>
          {join.isPending ? t("points.joining") : t("points.join")}
        </Button>
        {join.isPending && isHardwareWalletMethod(wallet.method) ? <DeviceApprovalNote /> : null}
        {canJoin ? (
          <JoinNote withLink={false} />
        ) : (
          <p className="text-center text-caption text-faint">{errorText(capabilityRefusal(wallet.method, "points", "join Gleam Points"))}</p>
        )}
      </ScreenFooter>

      <AboutPoints />
    </form>
  );
}

function JoinedView({
  runtime,
  wallet,
  standing,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  standing: Extract<ReturnType<typeof usePointsStanding>, { status: "joined" }>;
}) {
  const t = useT();
  const { score } = standing;
  const total = useCountUp(standing.estimateAtomic, score?.totalAtomic ?? null);
  const { copied, copy } = useCopy(inviteLinkFor(standing.membership.inviteCode));
  const seatsLeft = score?.seatsLeft ?? null;
  const prompt = useSharePrompt({ runtime, wallet, score });
  // The join welcome belongs to the standing; the other prompts are news about the invites.
  const welcome = prompt?.kind === "joined" ? prompt.text : null;
  // The count shows only right after a copy, then fades; at rest the line carries prompt news.
  const countNote = useFlash();
  const status =
    countNote.phase !== "hidden" && seatsLeft !== null ? invitesRemainingLine(seatsLeft) : welcome ? null : (prompt?.text ?? null);
  // A full code sends friends to a "full" invite page, so there's nothing to share.
  const full = seatsLeft !== null && seatsLeft <= 0;
  const friends = score?.refereeCount ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-9 px-6 phone:px-5 pb-6 pt-6">
      <Standing
        score={score}
        total={formatPoints(total.shown)}
        highlighted={total.highlighted}
        welcome={welcome}
        holdsNothing={standing.holdsNothing}
      />

      {standing.linkedElsewhere ? (
        <ReconnectNotice runtime={runtime} wallet={wallet} />
      ) : (
        <>
          <section aria-labelledby="ways-to-earn" className="flex flex-col gap-3">
            <h2 id="ways-to-earn" className="text-body text-foreground">
              {t("points.waysToEarn")}
            </h2>
            <div className="flex flex-col gap-6 rounded-xl bg-mist p-4">
              <EarnItem label={t("points.invite")}>
                {full ? (
                  <p className="text-label text-foreground">{t("points.invitesFull")}</p>
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <button
                      type="button"
                      className={cn(ACTION_LINK, copied && "text-positive")}
                      onClick={() => {
                        copy();
                        prompt?.finish();
                        countNote.flash();
                      }}
                    >
                      {copied ? t("points.copied") : t("points.inviteFriend")}
                      {copied ? <CheckIcon className={ACTION_ICON} /> : <CopyIcon className={ACTION_ICON} />}
                    </button>
                    {status ? (
                      <span
                        role="status"
                        className={cn(
                          "text-label text-muted transition-opacity duration-700 motion-reduce:transition-none",
                          countNote.phase === "fading" && "opacity-0",
                        )}
                      >
                        {status}
                      </span>
                    ) : null}
                  </div>
                )}
                <p className="mt-1.5 text-label text-muted">
                  {t("points.referralBefore")}
                  {REFERRAL_PERCENT}%{t("points.referralAfter")}
                </p>
                {friends > 0 ? (
                  <p className="text-label text-muted">
                    {t(friends === 1 ? "points.joinedOne" : "points.joinedMany", { count: friends })}
                  </p>
                ) : null}
              </EarnItem>
              <ReviewItem runtime={runtime} />
            </div>
          </section>
          <RecentEarnings
            entries={score?.recent ?? []}
            referralPercent={REFERRAL_PERCENT}
            friends={score?.refereeCount ?? 0}
          />
        </>
      )}

      <AboutPoints className="mt-auto">
        <LeaveControl
          runtime={runtime}
          wallet={wallet}
          points={formatPoints(standing.estimateAtomic)}
        />
      </AboutPoints>
    </div>
  );
}

/**
 * Shown when the server lists this wallet under another install's device.
 * Joining again from here only moves the wallet to this install (the
 * server keeps its points, invite code and referrer), so it earns from
 * this install's heartbeats again. It replaces Ways to earn so the screen
 * keeps one primary action.
 */
function ReconnectNotice({ runtime, wallet }: { runtime: RuntimePort; wallet: WalletSummary }) {
  const t = useT();
  const join = useJoinPoints(runtime);

  return (
    <section aria-label={t("points.elsewhereTitle")} className="flex flex-col gap-3">
      <h2 className="text-h3 font-semibold text-foreground">{t("points.elsewhereTitle")}</h2>
      <p className="text-label text-muted">
        {t("points.elsewhereBody")}
      </p>
      <Button type="button" disabled={join.isPending} onClick={() => join.mutate({ walletId: wallet.id })}>
        {join.isPending ? t("points.joining") : t("points.joinAgain")}
      </Button>
      {join.isPending && isHardwareWalletMethod(wallet.method) ? <DeviceApprovalNote /> : null}
      {join.error instanceof Error ? <p className="text-caption text-warning">{errorText(join.error)}</p> : null}
    </section>
  );
}
