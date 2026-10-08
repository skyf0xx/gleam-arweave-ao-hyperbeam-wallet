import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PointsMembership, PointsScores, PointsWalletScore, RuntimePort, WalletSummary } from "@gleam/core";
import { DEFAULT_AO_TOKEN } from "@gleam/ui";
import { estimatePoints, ownDailyRate } from "@gleam/core/src/points/index.ts";
import { useBalances } from "../../activity/src/useBalances";

export const pointsQueryKeys = {
  memberships: () => ["points", "memberships"] as const,
  scores: () => ["points", "scores"] as const,
};

/** Scores change once a day, so a popup session reads them once. */
const SCORES_STALE_MS = 5 * 60_000;

export function usePointsMemberships(runtime: RuntimePort) {
  return useQuery({
    queryKey: pointsQueryKeys.memberships(),
    queryFn: () =>
      runtime.send<undefined, Record<string, PointsMembership>>({ type: "getPointsMemberships", payload: undefined }),
  });
}

export function usePointsScores(runtime: RuntimePort, enabled: boolean) {
  return useQuery({
    queryKey: pointsQueryKeys.scores(),
    queryFn: () => runtime.send<undefined, PointsScores | null>({ type: "getPointsScores", payload: undefined }),
    enabled,
    staleTime: SCORES_STALE_MS,
  });
}

export function useJoinPoints(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: { walletId: string; inviteCode?: string }) =>
      runtime.send<typeof req, PointsMembership>({ type: "joinPoints", payload: req }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["points"] });
    },
  });
}

export function useLeavePoints(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: { walletId: string }) => runtime.send<typeof req, void>({ type: "leavePoints", payload: req }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["points"] });
    },
  });
}

export type PointsStanding =
  | { status: "loading" }
  | { status: "not-joined" }
  | {
      status: "joined";
      membership: PointsMembership;
      score: PointsWalletScore | null;
      /** Settled total projected forward to now; ticks while mounted. */
      estimateAtomic: string;
      dailyRateAtomic: string;
    };

/**
 * One wallet's points for display. Between daily snapshots the total is
 * projected from the wallet's current balances (POINTS.md § Extension),
 * so it moves while the popup is open. Before the first snapshot that
 * includes the wallet, the projection starts from when it joined.
 */
export function usePointsStanding(runtime: RuntimePort, wallet: WalletSummary): PointsStanding {
  const memberships = usePointsMemberships(runtime);
  const membership = memberships.data?.[wallet.id] ?? null;
  const scores = usePointsScores(runtime, membership !== null);
  const balances = useBalances(runtime, wallet.address);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!membership) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [membership]);

  if (memberships.isLoading) return { status: "loading" };
  if (!membership) return { status: "not-joined" };

  const score = scores.data?.wallets.find((candidate) => candidate.address === wallet.address) ?? null;
  const ao = balances.data?.tokenBalances.find((token) => token.processId === DEFAULT_AO_TOKEN.processId);
  const aoAtomic = ao && ao.available !== false ? ao.quantity : "0";
  const ownRate = ownDailyRate(balances.data?.arBalance ?? "0", aoAtomic, membership.referred);
  const dailyRateAtomic = (BigInt(ownRate) + BigInt(score?.lastDay?.referrerBonusAtomic ?? "0")).toString();

  const settledAt = scores.data?.settledAt ? Date.parse(scores.data.settledAt) : null;
  const settledAtMs = settledAt !== null && score?.lastDay ? settledAt : Math.max(settledAt ?? 0, membership.joinedAt);
  const estimateAtomic = estimatePoints({
    settledAtomic: score?.totalAtomic ?? "0",
    settledAtMs,
    dailyRateAtomic,
    nowMs,
  });

  return { status: "joined", membership, score, estimateAtomic, dailyRateAtomic };
}
