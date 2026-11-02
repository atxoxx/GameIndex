import type { ReactNode } from "react";

/** Top-level sections reachable from the settings rail — one route per tab. */
export type SettingsTab =
  | "overview"
  | "general"
  | "appearance"
  | "interface"
  | "hardware"
  | "integrations"
  | "discord"
  | "downloads"
  | "plugins"
  | "launcher"
  | "privacy"
  | "backup"
  | "saves"
  | "diagnostics"
  | "overlay"
  | "compatibility";

/** One destination in the settings rail (always a whole tab). */
export interface SettingsNavItem {
  tab: SettingsTab;
  label: string;
  /** One-line, plain-language summary shown under the active row. */
  hint?: string;
  icon: ReactNode;
  /** Optional count badge shown on the right edge of the row. */
  badge?: string;
}

/** A labelled group of rail destinations. */
export interface SettingsNavGroup {
  id: string;
  label: string;
  icon?: ReactNode;
  items: SettingsNavItem[];
}

/** One individual setting worth surfacing in cross-tab search. */
export interface SettingsSearchSetting {
  /** Anchor id of the row (used to flash the exact control after a jump). */
  id: string;
  /** i18n key for the control's visible label. */
  labelKey: string;
  /** Extra search terms (plain language, synonyms, jargon). */
  keywords?: string;
  /** Overrides the section the setting is filed under. */
  section?: string;
}

/** One scannable sub-section inside a tab (rail jump list + search index). */
export interface SettingsSectionDef {
  /** Anchor id on the section element — also the `?section=` deep-link key. */
  id: string;
  /** i18n key for the section title. */
  labelKey: string;
  /** English + technical keywords so search can find the section by term. */
  keywords: string;
  /** Optional small icon shown in the jump bar chip. */
  icon?: ReactNode;
  /** False for expert-only sections, hidden while "Essentials" is on. */
  essential?: boolean;
  /** Individual controls inside this section, indexed for search. */
  settings?: SettingsSearchSetting[];
}

/** A single searchable destination (tab, section or individual setting). */
export interface SettingsSearchEntry {
  id: string;
  tab: SettingsTab;
  kind: "tab" | "section" | "setting";
  label: string;
  /** Group + tab (+ section) breadcrumb shown beside the result. */
  crumb: string;
  keywords: string;
  icon?: ReactNode;
  /** For settings: the section anchor the result should land on. */
  sectionId?: string;
}
