import type { ReactNode } from "react";

/** Section of the edit-game modal, in tab order. */
export type EditGameTab = "details" | "media" | "launch" | "compatibility";

export interface EditGameTabDef {
  key: EditGameTab;
  /** i18n key for the tab label, shared with the modal's own tab bar. */
  labelKey: string;
  icon: ReactNode;
}

/**
 * Single source of truth for the edit modal's sections. The modal renders
 * them as tabs; the quick-actions menu, the wine-logs viewer and the game
 * page toolbar render them as jump buttons into the matching tab.
 */
export const EDIT_GAME_TABS: EditGameTabDef[] = [
  {
    key: "details",
    labelKey: "edit.tab.details",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    ),
  },
  {
    key: "media",
    labelKey: "edit.tab.media",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
  {
    key: "launch",
    labelKey: "edit.tab.launch",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
  },
  {
    key: "compatibility",
    labelKey: "edit.tab.compatibility",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
];
