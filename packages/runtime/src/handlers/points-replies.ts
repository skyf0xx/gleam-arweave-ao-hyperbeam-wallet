import { z } from "zod";

/** What a refusal from the points API carries: its `error` sentence and `code`. Anything else in the body, or a body that isn't an object, reads as none. */
export const errorBodySchema = z.object({ error: z.unknown().optional(), code: z.unknown().optional() }).nullable().catch(null);

export const joinReplySchema = z.object({ address: z.string(), inviteCode: z.string(), referred: z.boolean() });

export const attestReplySchema = z.object({
  ok: z.literal(true),
  attestationId: z.string(),
  points: z.string().regex(/^\d+$/),
  paid: z.boolean(),
  paidPlacesLeft: z.number(),
  unpaidReason: z.enum(["places_taken", "no_snapshot"]).nullish().catch(null),
});

export const redeemReplySchema = z.object({
  result: z.enum(["ok", "full", "unknown"]),
  kind: z.enum(["member", "drop"]).optional().catch(undefined),
});

/** A scores reply is checked for its `wallets` list only; the rest passes through as the server sent it. */
export const scoresReplySchema = z.looseObject({ wallets: z.array(z.unknown()) });
