import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";import {
  Camera,
  Check,
  ChevronDown,
  Circle,
  Clapperboard,
  ExternalLink,
  Eye,
  FolderOpen,
  Gamepad2,
  HelpCircle,
  Loader2,
  Save,
  Square,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { safeArtworkUrl, resolveGameLogo } from "../../utils/artworkUrl";
import { useOverlay } from "../../context/OverlayContext";
import { useLanguage } from "../../context/LanguageContext";
import OverlayPanelTabs from "./OverlayPanelTabs";
import HotkeyCheatsheet from "./HotkeyCheatsheet";
import { Skeleton } from "../ui";
import { useOverlayGame } from "./useOverlayGame";
import { useOverlayNotifications } from "./overlayNotifications";
import { formatClock, useSessionElapsed } from "./overlayTime";
import {
  availablePanelSections,
  type OverlayPanelSection,
} from "./panelSections";

// Every widget is its own Vite chunk: a section's code (and whatever it pulls
// in) is only fetched the first time it is opened, so the panel itself stays
// cheap to mount.
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

const WIDGETS: Record<string, ComponentType<{ bare?: boolean }>> = {
  session: SessionWidget,
  performance: PerformanceWidget,
  guides: GuidesWidget,
  achievements: AchievementsWidget,
  downloads: DownloadsWidget,
  notifications: NotificationsWidget,
  notes: NotesWidget,
  captures: ScreenshotsWidget,
  recording: RecordingWidget,
  timer: TimerWidget,
  settings: SettingsWidget,
};

/** Placeholder shown while a widget's chunk is still downloading. */
function WidgetFallback() {
  return <Skeleton shape="rect" width="100%" height="140px" />;
}

/**
 * OverlayPanel — the expanded HUD.
 *
 * A left rail lists every enabled section, the header carries the session
 * identity plus the capture controls, and the body renders one section at a
 * time. Sections that own several widgets split them into sub-tabs instead of
 * one long scroll. The last section is remembered through overlay settings.
 */
export default function OverlayPanel() {
  const {
    settings,
    metrics,
    session,
    collapse,
    captureScreenshot,
    isCapturing,
    lastCapturedScreenshot,
    openScreenshotsFolder,
    flashScreen,
    captureSupported,
    isRecording,
    isReplayBuffering,
    recordingState,
    toggleRecording,
    saveReplay,
    updateSettings,
  } = useOverlay();
  const { t } = useLanguage();
  const activeGame = useOverlayGame(session);
  const { unreadCount, markAllSeen } = useOverlayNotifications();
  const elapsed = useSessionElapsed(session?.startedAt ?? null);
  const recSeconds = useSessionElapsed(
    isRecording ? recordingState.startedAt ?? null : null,
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [subtabState, setSubtabState] = useState<Record<string, string>>({});
  const [helpOpen, setHelpOpen] = useState(false);
  const [openingFull, setOpeningFull] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const sections = useMemo(
    () => availablePanelSections(settings.panelWidgets),
    [settings.panelWidgets],
  );
  const active: OverlayPanelSection =
    sections.find((section) => section.id === activeId) ??
    sections.find((section) => section.id === settings.lastPanelSection) ??
    sections[0];

  const activeSubtab = active?.subtabs?.find(
    (tab) => tab.id === subtabState[active.id],
  ) ?? active?.subtabs?.[0];

  // Opening the notification feed is what marks it read; the rail badge and
  // the ticker badge share the same persisted marker.
  useEffect(() => {
    if (
      active?.id === "activity" &&
      activeSubtab?.id === "notifications" &&
      unreadCount > 0
    ) {
      markAllSeen();
    }
  }, [active?.id, activeSubtab?.id, unreadCount, markAllSeen]);

  const widgetKey = activeSubtab?.widgetKey ?? active?.widgetKeys[0];
  const Widget = widgetKey ? WIDGETS[widgetKey] : null;

  useEffect(() => {
    setThumbFailed(false);
    setLogoFailed(false);
  }, [activeGame?.id, session?.name]);

  const thumbnail = useMemo(() => {
    if (!activeGame || thumbFailed) return null;
    return safeArtworkUrl(activeGame.iconUrl || activeGame.coverArtUrl);
  }, [activeGame, thumbFailed]);

  const logo = useMemo(() => {
    if (!activeGame || logoFailed) return null;
    return resolveGameLogo(activeGame);
  }, [activeGame, logoFailed]);

  const displayName =
    activeGame?.name || session?.name || t("overlay.title");

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

  const selectSection = useCallback(
    (id: string) => {
      setActiveId(id);
      if (settings.lastPanelSection !== id) {
        void updateSettings({ lastPanelSection: id });
      }
    },
    [settings.lastPanelSection, updateSettings],
  );

  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const viewCapture = () => {
    setToastVisible(false);
    if (sections.some((section) => section.id === "captures")) {
      selectSection("captures");
      setSubtabState((prev) => ({ ...prev, captures: "screenshots" }));
    }
  };

  const handleQuickCapture = () => {
    void captureScreenshot(activeGame?.name ?? session?.name);
  };

  const openFullSettings = async () => {
    setOpeningFull(true);
    try {
      await invoke("overlay_open_settings");
    } catch {
      /* no Tauri runtime */
    } finally {
      setOpeningFull(false);
    }
  };

  const f = metrics?.fps;
  const fpsClass =
    typeof f === "number" ? (f >= 60 ? "good" : f >= 30 ? "fair" : "low") : "low";

  return (
    <div
      className="overlay-panel"
      data-testid="overlay-panel"
      data-density={settings.panelDensity ?? "comfortable"}
      style={{ opacity: `var(--overlay-opacity, ${settings.opacity})` }}
    >
      {flashScreen && <div className="overlay-screen-flash" aria-hidden />}

      <header className="overlay-panel__head" data-tauri-drag-region="deep">
        <div className="overlay-panel__identity">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              className="overlay-panel__game-thumb"
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <span className="overlay-panel__game-icon-fallback" aria-hidden>
              <Gamepad2 size={16} />
            </span>
          )}

          <div className="overlay-panel__meta">
            {logo ? (
              <img
                src={logo}
                alt={activeGame?.name || ""}
                className="overlay-panel__game-logo"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <span className="overlay-panel__title" title={displayName}>
                {displayName}
              </span>
            )}
            <span className="overlay-panel__session">
              {session ? (
                <>
                  <span className="overlay-panel__live-dot" aria-hidden />
                  <span className="overlay-panel__clock">
                    {formatClock(elapsed)}
                  </span>
                </>
              ) : (
                <span>{t("overlay.noSession")}</span>
              )}
            </span>
          </div>
        </div>

        <div className="overlay-panel__tools" data-tauri-drag-region="false">
          {typeof f === "number" && f > 0 && (
            <span
              className={`overlay-panel__fps-badge fps-${fpsClass}`}
              title={t("overlay.metric.fpsHint")}
            >
              {Math.round(f)} FPS
            </span>
          )}

          {isRecording && (
            <span className="overlay-panel__rec" role="status">
              <span className="overlay-panel__rec-dot" aria-hidden />
              <span>
                {t("overlay.ticker.rec")} {formatClock(recSeconds)}
              </span>
            </span>
          )}

          <button
            type="button"
            className="overlay-panel__tool"
            onClick={handleQuickCapture}
            disabled={isCapturing}
            title={t("overlay.action.screenshotHint")}
            aria-label={t("overlay.action.screenshot")}
            data-testid="overlay-panel-screenshot"
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
              className={`overlay-panel__tool${
                isRecording ? " overlay-panel__tool--recording" : ""
              }`}
              onClick={() => void toggleRecording()}
              title={
                isRecording
                  ? t("overlay.recording.stop")
                  : t("overlay.recording.start")
              }
              aria-label={
                isRecording
                  ? t("overlay.recording.stop")
                  : t("overlay.recording.start")
              }
              data-testid="overlay-panel-record"
            >
              {isRecording ? <Square size={13} /> : <Circle size={13} />}
            </button>
          )}

          {captureSupported && isReplayBuffering && (
            <button
              type="button"
              className="overlay-panel__tool overlay-panel__tool--active"
              onClick={() => void saveReplay()}
              title={t("overlay.recording.saveReplay")}
              aria-label={t("overlay.recording.saveReplay")}
              data-testid="overlay-panel-save-replay"
            >
              <Save size={14} />
            </button>
          )}

          {isReplayBuffering && !isRecording && (
            <span
              className="overlay-panel__armed"
              title={t("overlay.ticker.replayArmed")}
              aria-hidden
            >
              <Clapperboard size={13} />
            </span>
          )}

          <span className="overlay-panel__divider" aria-hidden />

          <button
            type="button"
            className="overlay-panel__tool"
            onClick={() => setHelpOpen(true)}
            title={t("overlay.help.open")}
            aria-label={t("overlay.help.open")}
            data-testid="overlay-panel-help"
          >
            <HelpCircle size={14} />
          </button>

          <button
            type="button"
            className="overlay-panel__collapse"
            onClick={collapse}
            aria-label={t("overlay.collapse")}
            title={t("overlay.collapse")}
            data-testid="overlay-panel-collapse"
          >
            <ChevronDown aria-hidden size={16} />
          </button>
        </div>
      </header>

      {toastVisible && lastCapturedScreenshot && (
        <div className="overlay-capture-toast" role="status">
          <div className="overlay-capture-toast__left">
            <Check size={13} className="overlay-capture-toast__ok" aria-hidden />
            <span>{t("overlay.screenshot.captured")}</span>
          </div>
          <div className="overlay-capture-toast__right">
            <button type="button" className="overlay-toast-btn" onClick={viewCapture}>
              <Eye size={12} aria-hidden />
              <span>{t("overlay.screenshot.view")}</span>
            </button>
            <button
              type="button"
              className="overlay-toast-btn"
              onClick={() => {
                void openScreenshotsFolder(lastCapturedScreenshot.filePath);
                setToastVisible(false);
              }}
              title={t("overlay.screenshot.openFolder")}
              aria-label={t("overlay.screenshot.openFolder")}
            >
              <FolderOpen size={12} aria-hidden />
            </button>
          </div>
        </div>
      )}

      <div className="overlay-panel__body">
        <nav
          className="overlay-rail"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t("overlay.tabs.aria")}
          data-tauri-drag-region="false"
          data-testid="overlay-rail"
          onKeyDown={(event) => {
            const index = sections.findIndex(
              (section) => section.id === active?.id,
            );
            if (index === -1) return;
            let next: OverlayPanelSection | undefined;
            if (event.key === "ArrowDown") {
              next = sections[(index + 1) % sections.length];
            } else if (event.key === "ArrowUp") {
              next = sections[(index - 1 + sections.length) % sections.length];
            } else if (event.key === "Home") {
              next = sections[0];
            } else if (event.key === "End") {
              next = sections[sections.length - 1];
            }
            if (!next) return;
            event.preventDefault();
            selectSection(next.id);
            document.getElementById(`overlay-tab-${next.id}`)?.focus();
          }}
        >
          {sections.map((section) => {
            const selected = section.id === active?.id;
            return (
              <button
                key={section.id}
                type="button"
                role="tab"
                id={`overlay-tab-${section.id}`}
                aria-selected={selected}
                aria-controls={`overlay-tabpanel-${section.id}`}
                tabIndex={selected ? 0 : -1}
                className={[
                  "overlay-rail__item",
                  selected ? "overlay-rail__item--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid={`overlay-panel-tab-${section.id}`}
                onClick={() => selectSection(section.id)}
              >
                <span className="overlay-rail__icon" aria-hidden>
                  {section.icon}
                </span>
                <span className="overlay-rail__label">{t(section.labelKey)}</span>
                {section.id === "activity" && unreadCount > 0 && (
                  <span
                    className="overlay-rail__badge"
                    aria-label={t("overlay.notifications.unread", {
                      count: unreadCount,
                    })}
                    data-testid="overlay-rail-badge-activity"
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {active && (
          <section
            className="overlay-section"
            role="tabpanel"
            id={`overlay-tabpanel-${active.id}`}
            aria-labelledby={`overlay-tab-${active.id}`}
            data-testid="overlay-panel-tabbody"
          >
            <div className="overlay-section__head">
              <div className="overlay-section__heading">
                <h2 className="overlay-section__title">{t(active.labelKey)}</h2>
                <p className="overlay-section__desc">{t(active.descKey)}</p>
              </div>
              {active.id === "captures" && lastCapturedScreenshot && (
                <span className="overlay-section__meta">
                  {t("overlay.screenshot.savedTo")}
                </span>
              )}
              {active.id === "settings" && (
                <button
                  type="button"
                  className="overlay-section__action"
                  onClick={() => void openFullSettings()}
                  disabled={openingFull}
                  title={t("overlay.settings.openFullDesc")}
                  data-testid="overlay-open-full-settings"
                >
                  {openingFull ? (
                    <Loader2 size={12} className="overlay-spin" />
                  ) : (
                    <ExternalLink size={12} />
                  )}
                  <span>{t("overlay.settings.openFull")}</span>
                </button>
              )}
            </div>

            {active.subtabs && active.subtabs.length > 1 && (
              <OverlayPanelTabs
                tabs={active.subtabs.map((tab) => ({
                  id: tab.id,
                  label: t(tab.labelKey),
                  icon: tab.icon,
                }))}
                active={activeSubtab?.id ?? active.subtabs[0].id}
                onSelect={(id) =>
                  setSubtabState((prev) => ({ ...prev, [active.id]: id }))
                }
                ariaLabel={t(active.labelKey)}
              />
            )}

            <div
              className="overlay-section__scroll"
              id={`overlay-subtabpanel-${activeSubtab?.id ?? active.id}`}
            >
              {Widget ? (
                <Suspense fallback={<WidgetFallback />}>
                  <Widget bare={Boolean(active.subtabs?.length)} />
                </Suspense>
              ) : (
                <WidgetFallback />
              )}
            </div>
          </section>
        )}
      </div>

      {helpOpen && (
        <HotkeyCheatsheet settings={settings} onClose={closeHelp} />
      )}
    </div>
  );
}
