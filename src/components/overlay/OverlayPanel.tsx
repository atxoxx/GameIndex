import { useState, useMemo, type ComponentType, type ReactNode } from "react";
import {
  ChevronDown,
  Camera,
  Timer,
  Sliders,
  Gamepad2,
  Activity,
  StickyNote,
  Bell,
  FolderOpen,
  Eye,
  Check,
  Loader2,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useOverlay } from "../../context/OverlayContext";
import { useLanguage } from "../../context/LanguageContext";
import { useOptionalGames } from "../../context/GameContext";
import OverlayPanelTabs from "./OverlayPanelTabs";
import SessionWidget from "./widgets/SessionWidget";
import PerformanceWidget from "./widgets/PerformanceWidget";
import AchievementsWidget from "./widgets/AchievementsWidget";
import DownloadsWidget from "./widgets/DownloadsWidget";
import NotificationsWidget from "./widgets/NotificationsWidget";
import NotesWidget from "./widgets/NotesWidget";
import ScreenshotsWidget from "./widgets/ScreenshotsWidget";
import TimerWidget from "./widgets/TimerWidget";
import SettingsWidget from "./widgets/SettingsWidget";

interface OverlayGroup {
  id: string;
  labelKey: string;
  icon: ReactNode;
  widgets: Record<string, ComponentType>;
}

const GROUPS: OverlayGroup[] = [
  {
    id: "session",
    labelKey: "overlay.group.session",
    icon: <Gamepad2 size={13} />,
    widgets: { session: SessionWidget },
  },
  {
    id: "performance",
    labelKey: "overlay.group.performance",
    icon: <Activity size={13} />,
    widgets: { performance: PerformanceWidget },
  },
  {
    id: "notes",
    labelKey: "overlay.group.notes",
    icon: <StickyNote size={13} />,
    widgets: { notes: NotesWidget },
  },
  {
    id: "captures",
    labelKey: "overlay.group.captures",
    icon: <Camera size={13} />,
    widgets: { captures: ScreenshotsWidget },
  },
  {
    id: "timer",
    labelKey: "overlay.group.timer",
    icon: <Timer size={13} />,
    widgets: { timer: TimerWidget },
  },
  {
    id: "activity",
    labelKey: "overlay.group.activity",
    icon: <Bell size={13} />,
    widgets: {
      achievements: AchievementsWidget,
      downloads: DownloadsWidget,
      notifications: NotificationsWidget,
    },
  },
  {
    id: "settings",
    labelKey: "overlay.group.settings",
    icon: <Sliders size={13} />,
    widgets: { settings: SettingsWidget },
  },
];

export default function OverlayPanel() {
  const {
    settings,
    corner,
    collapse,
    session,
    metrics,
    captureScreenshot,
    isCapturing,
    lastCapturedScreenshot,
    openScreenshotsFolder,
    flashScreen,
  } = useOverlay();
  const gameCtx = useOptionalGames();
  const games = gameCtx?.games ?? [];
  const { t } = useLanguage();
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeGame = useMemo(() => {
    if (!session?.gameId) return null;
    return games.find((g) => g.id === session.gameId);
  }, [session, games]);

  const enabled = new Set(settings.panelWidgets);
  const groups = GROUPS.map((group) => ({
    ...group,
    items: Object.entries(group.widgets).filter(([key]) => enabled.has(key)),
  })).filter((group) => group.items.length > 0);

  const active = groups.find((group) => group.id === activeId) ?? groups[0];

  const handleQuickCapture = () => {
    void captureScreenshot(activeGame?.name);
  };

  return (
    <div
      className="overlay-panel"
      data-testid="overlay-panel"
      data-corner={corner}
      style={{
        opacity: `var(--overlay-opacity, ${settings.opacity})`,
      }}
    >
      {/* Visual Screen Flash when screenshot is taken */}
      {flashScreen && <div className="overlay-screen-flash" aria-hidden />}

      {/* Panel Draggable Header */}
      <header className="overlay-panel__head" data-tauri-drag-region="deep">
        <div className="overlay-panel__title-wrap" data-tauri-drag-region="deep">
          {activeGame?.coverArtUrl ? (
            <img
              src={convertFileSrc(activeGame.coverArtUrl)}
              alt=""
              className="overlay-panel__game-thumb"
            />
          ) : (
            <div className="overlay-panel__game-icon-fallback">
              <Gamepad2 size={16} />
            </div>
          )}
          <div className="overlay-panel__game-meta">
            <span className="overlay-panel__title">
              {activeGame?.name || t("overlay.title")}
            </span>
            <span className="overlay-panel__hint">{t("overlay.escapeHint")}</span>
          </div>
        </div>

        {/* Live FPS chip in top bar */}
        {metrics?.fps !== undefined && metrics.fps > 0 && (
          <span
            className={`overlay-panel__fps-badge ${
              metrics.fps >= 60 ? "fps-good" : metrics.fps >= 30 ? "fps-fair" : "fps-low"
            }`}
          >
            {Math.round(metrics.fps)} FPS
          </span>
        )}

        {/* Quick action bar */}
        <div className="overlay-panel__quick-actions" data-tauri-drag-region="false">
          <button
            type="button"
            className="overlay-quick-action-btn overlay-capture-action"
            onClick={handleQuickCapture}
            disabled={isCapturing}
            title={t("overlay.action.screenshotHint")}
            aria-label={t("overlay.action.screenshot")}
          >
            {isCapturing ? (
              <Loader2 size={14} className="overlay-spin" />
            ) : (
              <Camera size={14} />
            )}
          </button>

          <button
            type="button"
            className={`overlay-quick-action-btn${active?.id === "timer" ? " active" : ""}`}
            onClick={() => setActiveId("timer")}
            title={t("overlay.action.timer")}
            aria-label={t("overlay.action.timer")}
          >
            <Timer size={14} />
          </button>

          <button
            type="button"
            className={`overlay-quick-action-btn${active?.id === "settings" ? " active" : ""}`}
            onClick={() => setActiveId("settings")}
            title={t("overlay.action.settings")}
            aria-label={t("overlay.action.settings")}
          >
            <Sliders size={14} />
          </button>

          <button
            type="button"
            className="overlay-panel__collapse"
            onClick={collapse}
            aria-label={t("overlay.collapse")}
            title={t("overlay.collapse")}
          >
            <ChevronDown aria-hidden />
          </button>
        </div>
      </header>

      {/* Floating Capture Notification Banner */}
      {lastCapturedScreenshot && (
        <div className="overlay-capture-toast" role="status">
          <div className="overlay-capture-toast__left">
            <Check size={14} className="text-success" />
            <span>{t("overlay.screenshot.captured")}</span>
          </div>
          <div className="overlay-capture-toast__right">
            <button
              type="button"
              className="overlay-toast-btn"
              onClick={() => setActiveId("captures")}
            >
              <Eye size={12} />
              <span>{t("overlay.screenshot.view")}</span>
            </button>
            <button
              type="button"
              className="overlay-toast-btn"
              onClick={() => void openScreenshotsFolder(lastCapturedScreenshot.filePath)}
            >
              <FolderOpen size={12} />
            </button>
          </div>
        </div>
      )}

      {active && (
        <>
          <OverlayPanelTabs
            tabs={groups.map((group) => ({
              id: group.id,
              label: t(group.labelKey),
              icon: group.icon,
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
