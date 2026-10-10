import { useState, type ComponentType } from "react";
import { ChevronDown } from "lucide-react";
import { useOverlay } from "../../context/OverlayContext";
import { useLanguage } from "../../context/LanguageContext";
import OverlayPanelTabs from "./OverlayPanelTabs";
import SessionWidget from "./widgets/SessionWidget";
import PerformanceWidget from "./widgets/PerformanceWidget";
import AchievementsWidget from "./widgets/AchievementsWidget";
import DownloadsWidget from "./widgets/DownloadsWidget";
import NotificationsWidget from "./widgets/NotificationsWidget";
import NotesWidget from "./widgets/NotesWidget";

interface OverlayGroup {
  id: string;
  labelKey: string;
  widgets: Record<string, ComponentType>;
}

const GROUPS: OverlayGroup[] = [
  {
    id: "session",
    labelKey: "overlay.group.session",
    widgets: { session: SessionWidget },
  },
  {
    id: "performance",
    labelKey: "overlay.group.performance",
    widgets: { performance: PerformanceWidget },
  },
  {
    id: "activity",
    labelKey: "overlay.group.activity",
    widgets: {
      achievements: AchievementsWidget,
      downloads: DownloadsWidget,
      notifications: NotificationsWidget,
      notes: NotesWidget,
    },
  },
];

/**
 * Expanded overlay — an interactive card grid grouped as
 * This session / Performance / Activity. Only the widgets listed in
 * `settings.panelWidgets` render; empty groups drop out of the tab bar, and
 * the panel shows one group at a time instead of one long scroll.
 */
export default function OverlayPanel() {
  const { settings, corner, collapse } = useOverlay();
  const { t } = useLanguage();
  const [activeId, setActiveId] = useState<string | null>(null);

  const enabled = new Set(settings.panelWidgets);
  const groups = GROUPS.map((group) => ({
    ...group,
    items: Object.entries(group.widgets).filter(([key]) => enabled.has(key)),
  })).filter((group) => group.items.length > 0);

  // Fall back to the first enabled tab before the user picks one, and again if
  // a settings change disables the tab that was active.
  const active = groups.find((group) => group.id === activeId) ?? groups[0];

  return (
    <div
      className="overlay-panel"
      data-testid="overlay-panel"
      data-corner={corner}
    >
      <header className="overlay-panel__head" data-tauri-drag-region="deep">
        <span className="overlay-panel__title">{t("overlay.title")}</span>
        <span className="overlay-panel__hint">{t("overlay.escapeHint")}</span>
        <button
          type="button"
          className="overlay-panel__collapse"
          data-tauri-drag-region="false"
          onClick={collapse}
          aria-label={t("overlay.collapse")}
          title={t("overlay.collapse")}
        >
          <ChevronDown aria-hidden />
        </button>
      </header>

      {active && (
        <>
          <OverlayPanelTabs
            tabs={groups.map((group) => ({
              id: group.id,
              label: t(group.labelKey),
            }))}
            active={active.id}
            onSelect={setActiveId}
            ariaLabel={t("overlay.tabs.aria")}
          />

          <div
            className="overlay-panel__body"
            role="tabpanel"
            id={`overlay-tabpanel-${active.id}`}
            aria-labelledby={`overlay-tab-${active.id}`}
            data-testid="overlay-panel-tabbody"
          >
            <div className="overlay-group__grid">
              {active.items.map(([key, Widget]) => (
                <Widget key={key} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
