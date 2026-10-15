/**
 * The downloaded keyfile's name. `chrome.downloads` rejects a filename
 * containing path separators or characters Windows forbids, which a
 * wallet name can contain, so those become dashes too. Bidi controls
 * are dropped so a name can't make the shown filename read in a
 * different order, and the name is capped well under filesystem limits.
 */
const MAX_NAME_LENGTH = 64;

export function keyfileFilename(walletName: string): string {
  const base = walletName
    .trim()
    .replace(/\s+/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/^[.-]+/, "")
    .toLowerCase()
    .slice(0, MAX_NAME_LENGTH);
  return base ? `${base}-arweave-keyfile.json` : "arweave-keyfile.json";
}
