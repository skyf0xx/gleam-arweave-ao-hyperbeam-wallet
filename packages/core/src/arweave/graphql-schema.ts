import { z } from "zod";

export const tagSchema = z.object({ name: z.string(), value: z.string() });

/** A field a gateway may leave out or send as `null`, read as `null` either way. */
export const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null);

/** A mined transaction's block, or `null` while it is unconfirmed. */
export const blockSchema = <T extends z.ZodRawShape>(shape: T) => nullable(z.object(shape));

/**
 * A GraphQL `transactions` connection: the edges (an absent list is an empty
 * one), each with its cursor and `node`, and the page info.
 */
export const transactionsConnection = <N extends z.ZodType>(node: N) =>
  z.object({
    edges: z
      .array(z.object({ cursor: z.string().optional(), node }))
      .nullish()
      .transform((edges) => edges ?? []),
    pageInfo: z.object({ hasNextPage: z.boolean().optional() }).nullish(),
  });

/** A gateway reply whose `data.transactions` holds `node`s; `data` may be `null` beside `errors`. */
export const transactionsReply = <N extends z.ZodType>(node: N) =>
  z.object({ data: z.object({ transactions: transactionsConnection(node).nullish() }).nullish() });

/** The `errors` a gateway reports, read before the data so a failed query names its cause. */
export const graphqlErrorsSchema = z.object({
  errors: z
    .array(z.object({ message: z.string() }))
    .optional()
    .catch(undefined),
});
