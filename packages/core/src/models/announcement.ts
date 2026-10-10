/** One entry of the site's `announcements.json`, after the extension has validated it. */
export interface Announcement {
  id: string;
  /** `critical` changes the styling only. */
  level: "info" | "critical";
  text: string;
  /** An https link on an allowed host; absent when the entry has none. */
  url?: string;
}
