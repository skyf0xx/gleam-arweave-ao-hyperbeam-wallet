/** One Arweave transaction or ANS-104 data item tag. */
export interface Tag {
  name: string;
  value: string;
}

/**
 * The value of the first tag called `name`: an exact match unless `anyCase`
 * (gateways return spawn tags in whatever case the spawner wrote).
 */
export function tagValue(tags: readonly Tag[], name: string, { anyCase = false }: { anyCase?: boolean } = {}): string | undefined {
  if (!anyCase) return tags.find((tag) => tag.name === name)?.value;
  const lower = name.toLowerCase();
  return tags.find((tag) => tag.name.toLowerCase() === lower)?.value;
}

/** Lower-cased tag names: gateways return spawn tags in whatever case the spawner wrote. */
export function tagMap(tags: Tag[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags) {
    if (typeof tag?.name === "string" && typeof tag.value === "string") out[tag.name.toLowerCase()] = tag.value;
  }
  return out;
}
