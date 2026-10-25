import type { ReactNode } from "react";
import {
  Activity,
  Bell,
  BookOpen,
  Camera,
  Clapperboard,
  Download,
  Gamepad2,
  Images,
  Sliders,
  StickyNote,
  Timer,
  Trophy,
} from "lucide-react";

/** One sub-view inside a section that groups several widgets. */
export interface OverlayPanelSubtab {
  id: string;
  labelKey: string;
  widgetKey: string;
  icon: ReactNode;
}

/** A rail entry and the widgets it reveals. */
export interface OverlayPanelSection {
  id: string;
  labelKey: string;
  descKey: string;
  icon: ReactNode;
  /** Panel widget keys that enable the section. */
  widgetKeys: string[];
  /** Always available, regardless of the widget toggles. */
  alwaysOn?: boolean;
  subtabs?: OverlayPanelSubtab[];
}

/**
 * The expanded panel's information architecture. The rail shows one entry per
 * section; sections that own several widgets expose them as sub-tabs instead
 * of one long scroll.
 */
export const PANEL_SECTIONS: OverlayPanelSection[] = [
  {
    id: "session",
    labelKey: "overlay.group.session",
    descKey: "overlay.section.sessionDesc",
    icon: <Gamepad2 size={15} />,
    widgetKeys: ["session"],
  },
  {
    id: "performance",
    labelKey: "overlay.group.performance",
    descKey: "overlay.section.performanceDesc",
    icon: <Activity size={15} />,
    widgetKeys: ["performance"],
  },
  {
    id: "captures",
    labelKey: "overlay.group.captures",
    descKey: "overlay.section.capturesDesc",
    icon: <Camera size={15} />,
    widgetKeys: ["captures", "recording"],
    subtabs: [
      {
        id: "screenshots",
        labelKey: "overlay.subtab.screenshots",
        widgetKey: "captures",
        icon: <Images size={13} />,
      },
      {
        id: "clips",
        labelKey: "overlay.subtab.clips",
        widgetKey: "recording",
        icon: <Clapperboard size={13} />,
      },
    ],
  },
  {
    id: "guides",
    labelKey: "overlay.group.guides",
    descKey: "overlay.section.guidesDesc",
    icon: <BookOpen size={15} />,
    widgetKeys: ["guides"],
    alwaysOn: true,
  },
  {
    id: "notes",
    labelKey: "overlay.group.notes",
    descKey: "overlay.section.notesDesc",
    icon: <StickyNote size={15} />,
    widgetKeys: ["notes"],
  },
  {
    id: "timer",
    labelKey: "overlay.group.timer",
    descKey: "overlay.section.timerDesc",
    icon: <Timer size={15} />,
    widgetKeys: ["timer"],
  },
  {
    id: "activity",
    labelKey: "overlay.group.activity",
    descKey: "overlay.section.activityDesc",
    icon: <Bell size={15} />,
    widgetKeys: ["achievements", "downloads", "notifications"],
    subtabs: [
      {
        id: "achievements",
        labelKey: "overlay.subtab.achievements",
        widgetKey: "achievements",
        icon: <Trophy size={13} />,
      },
      {
        id: "downloads",
        labelKey: "overlay.subtab.downloads",
        widgetKey: "downloads",
        icon: <Download size={13} />,
      },
      {
        id: "notifications",
        labelKey: "overlay.subtab.notifications",
        widgetKey: "notifications",
        icon: <Bell size={13} />,
      },
    ],
  },
  {
    id: "settings",
    labelKey: "overlay.group.settings",
    descKey: "overlay.section.settingsDesc",
    icon: <Sliders size={15} />,
    widgetKeys: ["settings"],
  },
];

/** Sections whose widgets survived the user's panel-widget toggles. */
export function availablePanelSections(
  enabled: Iterable<string>,
): OverlayPanelSection[] {
  const on = new Set(enabled);
  return PANEL_SECTIONS.map((section) => {
    if (section.alwaysOn) return section;
    const subtabs = section.subtabs?.filter((tab) => on.has(tab.widgetKey));
    const visible = section.widgetKeys.some((key) => on.has(key));
    if (!visible) return null;
    return { ...section, subtabs: subtabs?.length ? subtabs : undefined };
  }).filter((section): section is OverlayPanelSection => section !== null);
}
