import { securityPhraseSeed } from "../models/security-phrase";

export const ADDRESS_CHUNK_LENGTH = 4;

/** One 4-character slice of an address, by its position among all the chunks. */
export interface AddressChunk {
  index: number;
  text: string;
  emphasized: boolean;
}

/**
 * The address cut into 4-character chunks in two rows, the first one
 * chunk longer than half (a 43-character Arweave address reads 7 · 4). The first and last
 * chunks are emphasised, plus two middle ones picked by `emphasisPick`.
 * An attacker grinding a lookalike matches the ends people check; the
 * middle pair is the user's own, so a fake can't know which chunks to copy.
 */
export function chunkAddress(address: string, emphasisPick: number | null): AddressChunk[][] {
  const texts: string[] = [];
  for (let start = 0; start < address.length; start += ADDRESS_CHUNK_LENGTH) {
    texts.push(address.slice(start, start + ADDRESS_CHUNK_LENGTH));
  }
  const emphasized = new Set([0, texts.length - 1, ...middleChunks(texts.length, emphasisPick)]);
  const firstRow = Math.min(texts.length, Math.ceil(texts.length / 2) + 1);
  const toChunk = (text: string, index: number): AddressChunk => ({ index, text, emphasized: emphasized.has(index) });
  const chunks = texts.map(toChunk);
  return [chunks.slice(0, firstRow), chunks.slice(firstRow)].filter((row) => row.length > 0);
}

/**
 * Two middle chunks, neither next to the other nor to an end chunk. With
 * no pick, the pair sits a third of the way in from each end, which for a
 * 43-character address is chunks 3 and 7.
 */
export function middleChunks(chunkCount: number, emphasisPick: number | null): [number, number] | [] {
  const pairs: [number, number][] = [];
  for (let first = 2; first <= chunkCount - 3; first++) {
    for (let second = first + 2; second <= chunkCount - 3; second++) pairs.push([first, second]);
  }
  if (pairs.length === 0) return [];
  if (emphasisPick !== null) return pairs[emphasisPick % pairs.length]!;
  const inset = Math.floor((chunkCount - 1) / 3);
  return pairs.find(([first, second]) => first === inset && second === chunkCount - 1 - inset) ?? pairs[0]!;
}

/**
 * The user's emphasis pick: the first four bytes of
 * HMAC-SHA256(security-phrase word, "pos"). The same for every address, so
 * the user learns which chunks to check. `null` without a phrase.
 */
export async function addressEmphasisPick(securityPhraseWord: string | null): Promise<number | null> {
  if (securityPhraseWord === null) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(securityPhraseSeed(securityPhraseWord)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode("pos")));
  return new DataView(mac.buffer).getUint32(0);
}
