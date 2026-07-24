import { useState, useMemo, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useDownloads } from "../../context/DownloadContext";
import { useGames } from "../../context/GameContext";
import { useAchievements } from "../../context/AchievementContext";
import { useSettings } from "../../context/SettingsContext";
import { useTheme } from "../../context/ThemeContext";
import { useDriveUsage } from "../../pages/storage/useDriveUsage";
import { useFocusable } from "../../hooks/useFocusable";
import { driveBuckets } from "../../pages/storage/utils";

type SystemSection = "downloads" | "storage" | "achievements" | "settings";

export default function BigScreenSystem() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const SECTIONS: { id: SystemSection; label: string; icon: string }[] = [
    { id: "downloads", label: t("bigscreen.system.menuDownloads"), icon: "📥" },
    { id: "storage", label: t("bigscreen.system.menuStorage"), icon: "💾" },
    { id: "achievements", label: t("bigscreen.system.menuAchievements"), icon: "🏆" },
    { id: "settings", label: t("bigscreen.system.menuPreferences"), icon: "⚙️" },
  ];

  // Find initial section from current pathname
  const initialSection = useMemo<SystemSection>(() => {
    const path = location.pathname;
    if (path.startsWith("/storage")) return "storage";
    if (path.startsWith("/downloads")) return "downloads";
    if (path.startsWith("/achievements")) return "achievements";
    return "settings";
  }, [location.pathname]);

  const [activeSection, setActiveSection] = useState<SystemSection>(initialSection);

  // Sync active section with route changes (header/deep-linking)
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith("/storage")) {
      setActiveSection("storage");
    } else if (path.startsWith("/downloads")) {
      setActiveSection("downloads");
    } else if (path.startsWith("/achievements")) {
      setActiveSection("achievements");
    } else if (path.startsWith("/settings")) {
      setActiveSection("settings");
    }
  }, [location.pathname]);

  // Navigate to appropriate route when section is updated
  const handleSelectSection = useCallback((sec: SystemSection) => {
    setActiveSection(sec);
    if (sec === "settings") navigate("/settings");
    else navigate(`/${sec}`);
  }, [navigate]);

  return (
    <div className="bigscreen-system-hub">
      {/* Left Menu Pane */}
      <div className="bigscreen-system-left-pane">
        <h2 className="bigscreen-system-title">{t("bigscreen.system.title")}</h2>
        <div className="bigscreen-system-menu" role="tablist">
          {SECTIONS.map((sec) => {
            const isActive = activeSection === sec.id;
            const focusProps = useFocusable(() => handleSelectSection(sec.id));
            return (
              <button
                type="button"
                key={sec.id}
                aria-selected={isActive}
                className={`bigscreen-system-menu-item ${isActive ? "active" : ""}`}
                {...focusProps}
              >
                <span className="menu-item-icon">{sec.icon}</span>
                <span className="menu-item-label">{sec.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Details View Pane */}
      <div className="bigscreen-system-right-pane">
        {activeSection === "downloads" && <DownloadsView />}
        {activeSection === "storage" && <StorageView />}
        {activeSection === "achievements" && <AchievementsHubView />}
        {activeSection === "settings" && <SettingsView />}
      </div>
    </div>
  );
}

// ── SUB-VIEWS ────────────────────────────────────────────────────────

// 1. Downloads View
function DownloadsView() {
  const { t } = useLanguage();
  const { downloads, pauseDownload, resumeDownload, removeDownload } = useDownloads();

  const handlePause = useCallback((id: string) => {
    pauseDownload(id);
  }, [pauseDownload]);

  const handleResume = useCallback((id: string) => {
    resumeDownload(id);
  }, [resumeDownload]);

  const handleCancel = useCallback((id: string) => {
    removeDownload(id, true);
  }, [removeDownload]);

  return (
    <div className="bigscreen-system-section-view">
      <h3>{t("bigscreen.system.activeDownloads")}</h3>
      {downloads.length === 0 ? (
        <div className="system-view-empty">
          <p>{t("bigscreen.system.noDownloads")}</p>
        </div>
      ) : (
        <div className="system-downloads-list">
          {downloads.map((dl) => {
            const isDownloading = dl.status.kind === "downloading" || dl.status.kind === "fetchingMetadata";
            const resumeProps = useFocusable(() => handleResume(dl.id));
            const pauseProps = useFocusable(() => handlePause(dl.id));
            const cancelProps = useFocusable(() => handleCancel(dl.id));

            return (
              <div key={dl.id} className="system-download-row">
                <div className="dl-row-header">
                  <span className="dl-name">{dl.name}</span>
                  <span className="dl-status-badge">{dl.status.kind.toUpperCase()}</span>
                </div>
                <div className="dl-progress-container">
                  <div className="dl-progress-bar">
                    <div className="dl-progress-fill" style={{ width: `${(dl.progress || 0) * 100}%` }} />
                  </div>
                  <span className="dl-percent">{Math.round((dl.progress || 0) * 100)}%</span>
                </div>
                <div className="dl-actions-row">
                  {isDownloading ? (
                    <button type="button" className="dl-action-btn dl-btn-pause" {...pauseProps}>
                      {t("bigscreen.system.pause")}
                    </button>
                  ) : (
                    <button type="button" className="dl-action-btn dl-btn-play" {...resumeProps}>
                      {t("bigscreen.system.resume")}
                    </button>
                  )}
                  <button type="button" className="dl-action-btn dl-btn-cancel" {...cancelProps}>
                    {t("bigscreen.system.cancel")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 2. Storage View
function StorageView() {
  const { t } = useLanguage();
  const { games } = useGames();
  const driveUsage = useDriveUsage(games);

  const buckets = useMemo(() => driveBuckets(games), [games]);

  return (
    <div className="bigscreen-system-section-view">
      <h3>{t("bigscreen.system.storageBreakdown")}</h3>
      {buckets.length === 0 ? (
        <div className="system-view-empty">
          <p>{t("bigscreen.system.noStorage")}</p>
        </div>
      ) : (
        <div className="system-storage-list">
          {buckets.map((b) => {
            const usage = driveUsage.get(b.label);
            const totalGb = usage ? (usage.total / (1024 * 1024 * 1024)).toFixed(0) : "0";
            const freeGb = usage ? (usage.free / (1024 * 1024 * 1024)).toFixed(0) : "0";
            const usedGb = usage ? ((usage.total - usage.free) / (1024 * 1024 * 1024)).toFixed(0) : "0";
            const pct = usage ? Math.round(((usage.total - usage.free) / usage.total) * 100) : 0;

            return (
              <div key={b.label} className="system-storage-row">
                <div className="storage-row-header">
                  <span className="drive-label">{b.label}</span>
                  <span className="drive-counts">
                    {t("bigscreen.system.driveCounts", { count: b.count, used: usedGb })}
                  </span>
                </div>
                <div className="dl-progress-bar">
                  <div className="dl-progress-fill storage-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="drive-space-meta">
                  <span>{t("bigscreen.system.storageUsage", { free: freeGb, total: totalGb })}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 3. Achievements Hub
function AchievementsHubView() {
  const { t } = useLanguage();
  const { games } = useGames();
  const { getGameAchievements } = useAchievements();
  const navigate = useNavigate();

  const gamesWithAchievements = useMemo(() => {
    return games
      .map((g) => {
        const data = getGameAchievements(g.id);
        return {
          game: g,
          data,
        };
      })
      .filter((x) => x.data && x.data.total > 0)
      .sort((a, b) => (b.data?.unlocked ?? 0) - (a.data?.unlocked ?? 0));
  }, [games, getGameAchievements]);

  return (
    <div className="bigscreen-system-section-view">
      <h3>{t("bigscreen.system.achievementsTracker")}</h3>
      {gamesWithAchievements.length === 0 ? (
        <div className="system-view-empty">
          <p>{t("bigscreen.system.noAchievements")}</p>
        </div>
      ) : (
        <div className="system-achievements-list">
          {gamesWithAchievements.map(({ game, data }) => {
            const pct = data ? Math.round((data.unlocked / data.total) * 100) : 0;
            const cardProps = useFocusable(() => navigate(`/library/${game.id}`));

            return (
              <div key={game.id} className="system-achievement-game-row" {...cardProps}>
                <div className="ach-game-header">
                  <span className="ach-game-name">{game.name}</span>
                  <span className="ach-game-counts">
                    {t("bigscreen.system.achCounts", { unlocked: data?.unlocked ?? 0, total: data?.total ?? 0, pct })}
                  </span>
                </div>
                <div className="dl-progress-bar">
                  <div className="dl-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 5. Settings View
function SettingsView() {
  const { t } = useLanguage();
  const { currentTheme, setTheme, themes } = useTheme();
  const { landingPage, setLandingPage } = useSettings();

  const handleCycleTheme = useCallback(() => {
    const ids = themes.map((t) => t.id);
    const idx = ids.indexOf(currentTheme);
    const nextIdx = (idx + 1) % ids.length;
    setTheme(ids[nextIdx]);
  }, [currentTheme, setTheme, themes]);

  const handleCycleLanding = useCallback(() => {
    const pages: ("library" | "store" | "activity" | "settings")[] = [
      "library",
      "store",
      "activity",
      "settings",
    ];
    const curPage = landingPage === "deals" || landingPage === "wishlist" || landingPage === "news" || landingPage === "community" || landingPage === "downloads" || landingPage === "storage" || landingPage === "achievements" ? "library" : landingPage;
    const idx = pages.indexOf(curPage as any);
    const nextIdx = (idx + 1) % pages.length;
    setLandingPage(pages[nextIdx] as any);
  }, [landingPage, setLandingPage]);

  const themeBtnProps = useFocusable(handleCycleTheme);
  const landingBtnProps = useFocusable(handleCycleLanding);

  return (
    <div className="bigscreen-system-section-view">
      <h3>{t("bigscreen.system.preferencesTitle")}</h3>
      <div className="system-settings-list">
        <div className="system-setting-row">
          <div className="setting-info">
            <span className="setting-label">{t("bigscreen.system.appearance")}</span>
            <span className="setting-desc">{t("bigscreen.system.appearanceDesc")}</span>
          </div>
          <button type="button" className="setting-cycle-btn" {...themeBtnProps}>
            {currentTheme.toUpperCase()}
          </button>
        </div>

        <div className="system-setting-row">
          <div className="setting-info">
            <span className="setting-label">{t("bigscreen.system.defaultPage")}</span>
            <span className="setting-desc">{t("bigscreen.system.defaultPageDesc")}</span>
          </div>
          <button type="button" className="setting-cycle-btn" {...landingBtnProps}>
            {landingPage.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
