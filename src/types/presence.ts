/**
 * Transient page activities that outrank the generic "browsing" presence.
 *
 * Pages publish one of these while the user is doing something more specific
 * than moving around the app — reading a news article, viewing an itch.io
 * page — and clear it on unmount. `useDiscordPresence` maps the hint onto a
 * Discord activity, so the builder stays free of React and page imports.
 */

export type PresenceActivityKind = "article" | "itch";

export interface PresenceActivityHint {
  kind: PresenceActivityKind;
  /** Article or game title. */
  title: string;
  /** Source name / author, shown as the second activity line. */
  subtitle?: string;
  /** Public https page to link to and expose as a button. */
  url?: string;
  /** Public https cover image for the activity art. */
  image?: string;
}
