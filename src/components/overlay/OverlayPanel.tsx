import {
  useState,
  useMemo,
  useEffect,
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  Camera,
  Video,
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
  BookOpen,
} from "lucide-react";
import { safeArtworkUrl, resolveGameLogo } from "../../utils/artworkUrl";
import { useOverlay } from "../../context/OverlayContext";
import { useLanguage } from "../../context/LanguageContext";
import { useOptionalGames } from "../../context/GameContext";
import OverlayPanelTabs from "./OverlayPanelTabs";
import { Skeleton } from "../ui";

// Every panel widget is its own Vite chunk: a tab's code (and whatever it
// pulls in) is only fetched the first time that tab is opened, so the panel
// itself stays cheap to mount.
const SessionWidget = lazy(() => import("./widgets/SessionWidget"));
const PerformanceWidget = lazy(() => import("./widgets/PerformanceWidget"));
const GuidesWidget = lazy(() => import("./widgets/GuidesWidget"));
const AchievementsWidget = lazy(() => import("./widgets/AchievementsWidget"));
const DownloadsWidget = lazy(() => import("./widgets/DownloadsWidget"));
const NotificationsWidget = lazy(() => import("./widgets/NotificationsWidget"));
const NotesWidget = lazy(() => import("./widgets/NotesWidget"));
const ScreenshotsWidget = lazy(() => import("./widgets/ScreenshotsWidget"));
const RecordingWidget = lazy(() => import("./widgets/RecordingWidget"));
const TimerWidget = lazy(() => import("./widgets/TimerWidget"));
const SettingsWidget = lazy(() => import("./widgets/SettingsWidget"));

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
    // Always available: the browser is the reason to open the panel mid-game,
    // so it stays out of the widget on/off list.
    id: "guides",
    labelKey: "overlay.group.guides",
    icon: <BookOpen size={13} />,
    widgets: { guides: GuidesWidget },
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
    widgets: { captures: ScreenshotsWidget, recording: RecordingWidget },
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

/** Placeholder shown for the moment a widget's chunk is still downloading. */
function WidgetFallback() {
  return <Skeleton shape="rect" width="100%" height="140px" />;
}

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
    captureSupported,
    isRecording,
    toggleRecording,
  } = useOverlay();
  const gameCtx = useOptionalGames();
  const games = gameCtx?.games ?? [];
  const runningGameIds = gameCtx?.runningGameIds ?? [];
  const { t } = useLanguage();
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeGame = useMemo(() => {
    if (session?.gameId) {
      const match = games.find(
        (g) => g.id === session.gameId || String(g.id) === String(session.gameId),
      );
      if (match) return match;
    }
    if (runningGameIds.length > 0) {
      return (
        games.find(
          (g) =>
            g.id === runningGameIds[0] ||
            String(g.id) === String(runningGameIds[0]),
        ) ?? null
      );
    }
    return null;
  }, [session, games, runningGameIds]);

  const [thumbFailed, setThumbFailed] = useState(false);
  const [headerLogoFailed, setHeaderLogoFailed] = useState(false);

  // The capture banner is a transient snackbar: show it when a capture lands,
  // then auto-dismiss so it can never linger over the panel content.
  const [toastVisible, setToastVisible] = useState(false);
  useEffect(() => {
    if (!lastCapturedScreenshot) {
      setToastVisible(false);
      return;
    }
    setToastVisible(true);
    const timer = window.setTimeout(() => setToastVisible(false), 6000);
    return () => window.clearTimeout(timer);
  }, [lastCapturedScreenshot]);

  useEffect(() => {
    setThumbFailed(false);
    setHeaderLogoFailed(false);
  }, [activeGame?.id]);

  const effectiveThumb = useMemo(() => {
    if (!activeGame || thumbFailed) return null;
    return safeArtworkUrl(activeGame.iconUrl || activeGame.coverArtUrl);
  }, [activeGame, thumbFailed]);

  const effectiveHeaderLogo = useMemo(() => {
    if (!activeGame || headerLogoFailed) return null;
    return resolveGameLogo(activeGame);
  }, [activeGame, headerLogoFailed]);

  const enabled = new Set(settings.panelWidgets);
  const groups = GROUPS.map((group) => ({
    ...group,
    // The Guides browser is not user-toggleable — it is always on.
    items:
      group.id === "guides"
        ? Object.entries(group.widgets)
        : Object.entries(group.widgets).filter(([key]) => enabled.has(key)),
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
          {effectiveThumb ? (
            <img
              src={effectiveThumb}
              alt=""
              className="overlay-panel__game-thumb"
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <div className="overlay-panel__game-icon-fallback">
              <Gamepad2 size={16} />
            </div>
          )}
          <div className="overlay-panel__game-meta">
            {effectiveHeaderLogo ? (
              <img
                src={effectiveHeaderLogo}
                alt={activeGame?.name || ""}
                className="overlay-panel__game-logo"
                onError={() => setHeaderLogoFailed(true)}
              />
            ) : (
              <span className="overlay-panel__title">
                {activeGame?.name || t("overlay.title")}
              </span>
            )}
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

          {captureSupported && (
            <button
              type="button"
              className={`overlay-quick-action-btn overlay-record-action${
                isRecording ? " active" : ""
              }`}
              onClick={() => void toggleRecording()}
              title={
                isRecording
                  ? t("overlay.recording.stop")
                  : t("overlay.recording.start")
              }
              aria-label={t("overlay.recording.start")}
            >
              <Video size={14} />
            </button>
          )}

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
      {toastVisible && lastCapturedScreenshot && (
        <div className="overlay-capture-toast" role="status">
          <div className="overlay-capture-toast__left">
            <Check size={14} className="text-success" />
            <span>{t("overlay.screenshot.captured")}</span>
          </div>
          <div className="overlay-capture-toast__right">
            <button
              type="button"
              className="overlay-toast-btn"
              onClick={() => {
                setActiveId("captures");
                setToastVisible(false);
              }}
            >
              <Eye size={12} />
              <span>{t("overlay.screenshot.view")}</span>
            </button>
            <button
              type="button"
              className="overlay-toast-btn"
              onClick={() => {
                void openScreenshotsFolder(lastCapturedScreenshot.filePath);
                setToastVisible(false);
              }}
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
              <Suspense fallback={<WidgetFallback />}>
                {active.items.map(([key, Widget]) => (
                  <Widget key={key} />
                ))}
              </Suspense>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
