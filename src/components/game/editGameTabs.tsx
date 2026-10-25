import { FileText, Images, Play, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

/** Section of the edit-game modal, in tab order. */
export type EditGameTab = "details" | "media" | "launch" | "compatibility";

export interface EditGameTabDef {
  key: EditGameTab;
  /** i18n key for the tab label, shared with the modal's own rail. */
  labelKey: string;
  icon: ReactNode;
}

/**
 * Single source of truth for the edit modal's areas. The modal renders them
 * as a rail; the quick-actions menu, the wine-logs viewer and the game page
 * toolbar render them as jump buttons into the matching area.
 */
export const EDIT_GAME_TABS: EditGameTabDef[] = [
  {
    key: "details",
    labelKey: "edit.tab.details",
    icon: <FileText size={14} aria-hidden="true" />,
  },
  {
    key: "media",
    labelKey: "edit.tab.media",
    icon: <Images size={14} aria-hidden="true" />,
  },
  {
    key: "launch",
    labelKey: "edit.tab.launch",
    icon: <Play size={14} aria-hidden="true" />,
  },
  {
    key: "compatibility",
    labelKey: "edit.tab.compatibility",
    icon: <Settings2 size={14} aria-hidden="true" />,
  },
];
