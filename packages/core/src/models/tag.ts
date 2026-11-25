/** One Arweave transaction or ANS-104 data item tag. */
export interface Tag {
  name: string;
  value: string;
}

/** Lower-cased tag names: gateways return spawn tags in whatever case the spawner wrote. */
export function tagMap(tags: Tag[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags) {
    if (typeof tag?.name === "string" && typeof tag.value === "string") out[tag.name.toLowerCase()] = tag.value;
  }
  return out;
}
