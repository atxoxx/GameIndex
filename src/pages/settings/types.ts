import type { ReactNode } from "react";

/** Top-level sections reachable from the settings sidebar. */
export type SettingsTab =
  | "general"
  | "appearance"
  | "hardware"
  | "integrations"
  | "downloads"
  | "launcher"
  | "privacy";

/** One destination in the sidebar (a tab, optionally scrolled to a sub-anchor). */
export interface SettingsNavItem {
  tab: SettingsTab;
  /** Optional in-page anchor (integration tile id, downloads card id). */
  anchor?: string;
  label: string;
  keywords: string;
  icon?: ReactNode;
}

/** A labelled group of sidebar destinations. */
export interface SettingsNavGroup {
  id: string;
  label: string;
  items: SettingsNavItem[];
}
