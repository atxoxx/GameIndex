import type { ReactNode } from "react";

/** Top-level sections reachable from the settings sidebar — one route per tab. */
export type SettingsTab =
  | "general"
  | "appearance"
  | "hardware"
  | "integrations"
  | "discord"
  | "downloads"
  | "plugins"
  | "launcher"
  | "privacy";

/** One destination in the sidebar (always a whole tab — never an in-tab anchor). */
export interface SettingsNavItem {
  tab: SettingsTab;
  label: string;
  icon: ReactNode;
  /** Optional count badge shown on the right edge of the row. */
  badge?: string;
}

/** A labelled group of sidebar destinations. */
export interface SettingsNavGroup {
  id: string;
  label: string;
  items: SettingsNavItem[];
}

/** One scannable sub-section inside a tab (jump bar + search index). */
export interface SettingsSectionDef {
  /** Anchor id on the section element — also the `?section=` deep-link key. */
  id: string;
  /** i18n key for the section title. */
  labelKey: string;
  /** English + technical keywords so search can find the section by term. */
  keywords: string;
  /** Optional small icon shown in the jump bar chip. */
  icon?: ReactNode;
}

/** A single searchable destination (tab or section inside a tab). */
export interface SettingsSearchEntry {
  id: string;
  tab: SettingsTab;
  kind: "tab" | "section";
  label: string;
  /** Group + tab breadcrumb shown beside the result. */
  crumb: string;
  keywords: string;
  icon?: ReactNode;
}
