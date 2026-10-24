/**
 * Who sent a message to the background, as the platform attests it. Each
 * shell's transport builds this from its platform's own view of the
 * sender (in the extension, Chrome's `runtime.MessageSender`), never from
 * the message body, so a page can't claim another origin or a higher
 * tier. The dispatcher and handlers see only this.
 *
 * - `extension`: one of the wallet's own pages (popup, side panel,
 *   approval and passkey windows).
 * - `contentScript`: the bridge for a web page's top frame, on `origin`.
 *   `tabId` names that page's tab so per-tab state can be kept, and is
 *   undefined when the platform didn't report one.
 */
export type CallerContext =
  | { tier: "extension" }
  | { tier: "contentScript"; origin: string; tabId: number | undefined };

export type CallerTier = CallerContext["tier"];
