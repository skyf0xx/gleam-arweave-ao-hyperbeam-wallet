import { z } from "zod";
import { tagSchema } from "../arweave/graphql-schema";

const unknownField = z.unknown().optional();

/** A tag list keeps its well-formed tags and drops the rest; a missing or non-array list is empty. */
const tagListSchema = z
  .array(tagSchema.nullable().catch(null))
  .catch([])
  .transform((tags) => tags.filter((tag) => tag !== null));

/** An outgoing message or dry-run reply: `Data`/`Tags` or their lowercase forms, whichever the node used. */
const messageSchema = z
  .object({ Data: unknownField, data: unknownField, Tags: unknownField, tags: unknownField })
  .transform((message) => ({
    data: message.Data ?? message.data,
    tags: tagListSchema.parse(message.Tags ?? message.tags),
  }));

const messageListSchema = z
  .array(messageSchema.nullable().catch(null))
  .catch([])
  .transform((messages) => messages.filter((message) => message !== null));

/**
 * A CU result or `dry-run` reply, whichever case the node used: its top-level
 * `Error` and the outgoing `Messages`. Anything that isn't an object has
 * neither, and a message that isn't an object is skipped.
 */
export const aoReplySchema = z
  .object({ Error: unknownField, error: unknownField, Messages: unknownField, messages: unknownField })
  .transform((body) => ({
    error: body.Error ?? body.error,
    messages: messageListSchema.parse(body.Messages ?? body.messages),
  }))
  .catch({ error: undefined, messages: [] });
