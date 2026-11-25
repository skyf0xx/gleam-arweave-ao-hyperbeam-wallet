import { z } from "zod";
import { isScanAreaId, type ScanAreaId } from "./areas";

/** A whole number of atomic units, as the API sends amounts. */
export const ATOMIC = /^\d{1,40}$/;

export const scanAreaIdSchema = z.custom<ScanAreaId>(isScanAreaId);

export const atomicSchema = z.string().regex(ATOMIC);

export const countSchema = z.number().refine((n) => Number.isInteger(n) && n >= 0);

/** One area of `GET /scan/areas`, and of `areasLeft` in `GET /scan/next`. */
export const areaCountsSchema = z.object({ id: scanAreaIdSchema, label: z.string(), functions: countSchema, examined: countSchema });

/** `GET /scan/next`; amounts are atomic-unit integer strings. */
export const scanNextSchema = z.object({
  release: z.string(),
  /** Null for a whole-surface scan recorded before areas. */
  area: scanAreaIdSchema.nullable(),
  /** Null for a scan recorded before rounds. */
  round: z
    .number()
    .refine((n) => Number.isInteger(n) && n >= 1)
    .nullable(),
  /** What this scan was credited. */
  points: atomicSchema,
  nextRound: z.number().refine(Number.isInteger),
  /** What the next round earns if submitted now; "0" when no paid place or snapshot day is left. */
  nextRewardAtomic: atomicSchema,
  nextPaid: z.boolean(),
  /** Areas the wallet hasn't scanned, least covered first; empty once the release isn't the latest. */
  areasLeft: z.array(areaCountsSchema),
  suggested: scanAreaIdSchema.nullable(),
});

export type ScanNext = z.output<typeof scanNextSchema>;
