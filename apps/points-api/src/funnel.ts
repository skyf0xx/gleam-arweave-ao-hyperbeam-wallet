import type { Queryable } from "./db";
import { MEMBER_CODE_SEATS, PENDING_MEMBER_REDEMPTIONS_SQL } from "./invite";

const RETENTION_DAYS = 28;

export interface CodeKindCounts {
  redemptions: number;
  /** Redeemed installs that registered at least one wallet. */
  claims: number;
  /** claims / redemptions, or null with no redemptions. */
  claimRate: number | null;
}

export interface DropCodeStats {
  code: string;
  label: string;
  /** null is unlimited. */
  seats: number | null;
  used: number;
  left: number | null;
  firstRedeemedAt: Date | null;
  lastRedeemedAt: Date | null;
  /** First to last redemption, in milliseconds. */
  drainMs: number | null;
}

export interface Funnel {
  member: CodeKindCounts;
  drop: CodeKindCounts;
  /** Member-code redemptions whose install has registered, returning the seat. */
  seatsRefilled: number;
  /** Seats left across all member codes under the Phase 1 rule. */
  memberSeatsUnused: number;
  dropCodes: DropCodeStats[];
  retention: {
    /** Claimed redemptions at least 28 days old. */
    eligible: number;
    retained: number;
    rate: number | null;
  };
}

function counts(redemptions: number, claims: number): CodeKindCounts {
  return { redemptions, claims, claimRate: redemptions === 0 ? null : claims / redemptions };
}

const CLAIMED_SQL = "EXISTS (SELECT 1 FROM wallets w WHERE w.device_id = ir.device_id)";

/**
 * Leaving deletes the device and, by cascade, its redemption, so installs
 * that left are absent from every number here.
 */
export async function readFunnel(db: Queryable, now: Date): Promise<Funnel> {
  // A redemption belongs to a drop code if it is in `drop_codes`, otherwise
  // it is a member code.
  const split = await db.query<{ is_drop: boolean; redemptions: string; claims: string }>(
    `SELECT (dc.code IS NOT NULL) AS is_drop,
            count(*)::text AS redemptions,
            (count(*) FILTER (WHERE ${CLAIMED_SQL}))::text AS claims
       FROM invite_redemptions ir
       LEFT JOIN drop_codes dc ON dc.code = ir.code
      GROUP BY 1`,
  );
  const row = (isDrop: boolean) => split.rows.find((r) => r.is_drop === isDrop);
  const member = counts(Number(row(false)?.redemptions ?? 0), Number(row(false)?.claims ?? 0));
  const drop = counts(Number(row(true)?.redemptions ?? 0), Number(row(true)?.claims ?? 0));

  const unused = await db.query<{ n: string }>(
    `SELECT coalesce(sum(greatest(0, $1::int - ${PENDING_MEMBER_REDEMPTIONS_SQL})), 0)::text AS n FROM wallets w`,
    [MEMBER_CODE_SEATS],
  );

  const drops = await db.query<{
    code: string;
    label: string;
    seats: number | null;
    used: string;
    first: Date | null;
    last: Date | null;
  }>(
    `SELECT dc.code, dc.label, dc.seats, count(ir.device_id)::text AS used,
            min(ir.redeemed_at) AS first, max(ir.redeemed_at) AS last
       FROM drop_codes dc
       LEFT JOIN invite_redemptions ir ON ir.code = dc.code
      GROUP BY dc.code
      ORDER BY dc.created_at, dc.code`,
  );

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const retention = await db.query<{ eligible: string; retained: string }>(
    `SELECT count(*)::text AS eligible,
            (count(*) FILTER (WHERE d.last_heartbeat_at >= ir.redeemed_at + make_interval(days => $2::int)))::text AS retained
       FROM invite_redemptions ir
       JOIN devices d ON d.id = ir.device_id
      WHERE ir.redeemed_at <= $1 AND ${CLAIMED_SQL}`,
    [cutoff, RETENTION_DAYS],
  );
  const eligible = Number(retention.rows[0]!.eligible);
  const retained = Number(retention.rows[0]!.retained);

  return {
    member,
    drop,
    seatsRefilled: member.claims,
    memberSeatsUnused: Number(unused.rows[0]!.n),
    dropCodes: drops.rows.map((r) => {
      const used = Number(r.used);
      const first = r.first ? new Date(r.first) : null;
      const last = r.last ? new Date(r.last) : null;
      return {
        code: r.code,
        label: r.label,
        seats: r.seats,
        used,
        left: r.seats === null ? null : Math.max(0, r.seats - used),
        firstRedeemedAt: first,
        lastRedeemedAt: last,
        drainMs: first && last ? last.getTime() - first.getTime() : null,
      };
    }),
    retention: { eligible, retained, rate: eligible === 0 ? null : retained / eligible },
  };
}

function percent(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatFunnel(funnel: Funnel): string {
  const kind = (name: string, c: CodeKindCounts) =>
    `  ${name.padEnd(7)} redeemed ${c.redemptions}, claimed ${c.claims} (${percent(c.claimRate)})`;
  const lines = [
    "Gleam Points funnel (API side; site clicks and invite page views are in Umami)",
    "",
    "Redemptions and claims",
    kind("member", funnel.member),
    kind("drop", funnel.drop),
    "",
    "Member seats",
    `  refilled ${funnel.seatsRefilled}, unused and held ${funnel.memberSeatsUnused}`,
    "",
    "Drop codes",
  ];
  if (funnel.dropCodes.length === 0) lines.push("  none");
  for (const d of funnel.dropCodes) {
    const seats = d.seats === null ? "unlimited" : `${d.seats} seats`;
    const left = d.left === null ? "" : `, ${d.left} left`;
    const drain = d.drainMs === null ? "no redemptions" : `drain ${formatDuration(d.drainMs)}`;
    lines.push(`  ${d.code}  ${d.label}  ${seats}, ${d.used} used${left}  ${drain}`);
  }
  const r = funnel.retention;
  lines.push(
    "",
    `Week-four retention (claimed, redeemed 28+ days ago)`,
    `  ${r.retained} of ${r.eligible} active 28 days after redeeming (${percent(r.rate)})`,
    "",
    "Installs that left are deleted with their redemption, so they drop out of every count.",
  );
  return lines.join("\n");
}
