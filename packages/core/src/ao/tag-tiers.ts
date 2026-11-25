import type { Tag } from "../models/tag";
import { HARMLESS_TAGS, isHarmlessTag } from "./other-tags";
import { ARWEAVE_ID } from "../models/arweave-id";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Protocol and client tags shown with the protocol tags whatever their
 * value, by lowercase name. Display only: unlike `HARMLESS_TAGS`, they still
 * count beside a transfer's headline. `ao-types` is HyperBEAM's type
 * annotation, and `reference` is a message counter that is not always a
 * number.
 */
const PROTOCOL_ANY_VALUE: ReadonlySet<string> = new Set([
  "reference",
  "client",
  "client-version",
  "signing-client",
  "signing-client-version",
  "ao-types",
  "require-codec",
  "accept-bundle",
  "signing-format",
]);

/**
 * A tag sorted under App tags. `unusual` marks a protocol tag name carrying
 * a value we don't expect, with the values we do.
 */
export type AppTag = Tag & { unusual?: { expected: string } };

/**
 * A signed item's tags sorted for reading. Every tag lands in exactly one
 * place, so nothing is dropped: the headline's tags, then addresses, app
 * tags and protocol tags, each in signing order.
 */
export interface TagTiers {
  /** `Action` (with `Quantity` beside it), or else a `Type` other than `Message`. A duplicated `Action`, `Quantity` or `Type` never headlines: every copy is an app tag. */
  headline: { tag: Tag; quantity: Tag | null } | null;
  /** Tags whose value is an Arweave or EVM address. */
  addresses: Tag[];
  app: AppTag[];
  /** Protocol tags carrying a value we expect. */
  protocol: Tag[];
}

/**
 * The first tag named `name`, in that exact case if there is one, else in
 * any case: HyperBEAM lowercases names (`action`), while aos matches
 * `Action` exactly.
 */
function byName(tags: readonly Tag[], name: string, accept: (tag: Tag) => boolean = () => true): Tag | null {
  const lower = name.toLowerCase();
  return (
    tags.find((tag) => tag.name === name && accept(tag)) ??
    tags.find((tag) => tag.name.toLowerCase() === lower && accept(tag)) ??
    null
  );
}

function isAddress(value: string): boolean {
  return ARWEAVE_ID.test(value) || EVM_ADDRESS_PATTERN.test(value);
}

/**
 * Sorts tags into the approval screen's tiers. The first `Action` heads the
 * item and any other stays an app tag. A name given twice, in any case, has
 * no single reading — a process could act on either copy — so a duplicated
 * `Action` heads nothing (not even a `Type` fallback), a duplicated
 * `Quantity` never sits beside the headline, and a duplicated `Type` never
 * heads the item either: every copy stays an app tag, where the reader can
 * see all of them. A `Type` of `Message` does not count toward the
 * duplication: it is the expected value, not a fallback candidate. A
 * protocol tag name with an unexpected value is never shown among the
 * protocol tags: it is lifted into App tags and marked.
 */
export function tierTags(tags: readonly Tag[]): TagTiers {
  const count = (name: string) => tags.filter((tag) => tag.name.toLowerCase() === name).length;
  const ambiguousAction = count("action") > 1;
  const action = ambiguousAction ? null : byName(tags, "Action");
  const ambiguousType = tags.filter((tag) => tag.name.toLowerCase() === "type" && tag.value !== "Message").length > 1;
  const type = action === null && !ambiguousAction && !ambiguousType ? byName(tags, "Type", (tag) => tag.value !== "Message") : null;
  const quantity = action !== null && count("quantity") === 1 ? byName(tags, "Quantity") : null;
  const headlineTag = action ?? type;

  const tiers: TagTiers = {
    headline: headlineTag === null ? null : { tag: headlineTag, quantity },
    addresses: [],
    app: [],
    protocol: [],
  };
  for (const tag of tags) {
    if (tag === headlineTag || tag === quantity) continue;
    const name = tag.name.toLowerCase();
    const expected = Object.hasOwn(HARMLESS_TAGS, name) ? HARMLESS_TAGS[name] : undefined;
    if (isHarmlessTag(tag) || PROTOCOL_ANY_VALUE.has(name)) tiers.protocol.push(tag);
    else if (expected) tiers.app.push({ ...tag, unusual: { expected: expected.join(" / ") } });
    else if (isAddress(tag.value)) tiers.addresses.push(tag);
    else tiers.app.push(tag);
  }
  return tiers;
}
