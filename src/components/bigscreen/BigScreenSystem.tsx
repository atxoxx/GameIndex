import { useState, useMemo, useEffect, useCallback, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useDownloads, type TorrentDownload } from "../../context/DownloadContext";
import { useGames } from "../../context/GameContext";
import { useAchievements } from "../../context/AchievementContext";
import { useSettings } from "../../context/SettingsContext";
import { useTheme } from "../../context/ThemeContext";
import { useDriveUsage } from "../../pages/storage/useDriveUsage";
import { useFocusable } from "../../hooks/useFocusable";
import { driveBuckets } from "../../pages/storage/utils";
import type { Game, GameAchievementData } from "../../types/game";
import "../../styles/achievements.css";

type SystemSection =
  | "downloads"
  | "storage"
  | "achievements"
  | "settings"
  | "mods"
  | "emulators"
  | "docs";

/** Minimal inline-SVG wrapper for the left-menu icons (repo convention:
 *  inline SVG only — no emoji, no icon library). Icons mirror the paths
 *  used by the shell registry (src/bigscreen/registry.tsx) so the System
 *  hub menu stays visually consistent with the header strip. */
function SystemIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const SYSTEM_ICONS: Record<Exclude<SystemSection, never>, ReactNode> = {
  downloads: (
    <SystemIcon>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </SystemIcon>
  ),
  storage: (
    <SystemIcon>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </SystemIcon>
  ),
  achievements: (
    <SystemIcon>
      <circle cx="12" cy="8" r="5" />
      <path d="m8.5 12.5-1 8 4.5-2.5 4.5 2.5-1-8" />
    </SystemIcon>
  ),
  settings: (
    <SystemIcon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
    </SystemIcon>
  ),
  mods: (
    <SystemIcon>
      <path d="M8 5h8l2 4v10H6V9l2-4Z" />
      <path d="M9 5v4h6V5" />
      <path d="M9 13h6M9 16h4" />
    </SystemIcon>
  ),
  emulators: (
    <SystemIcon>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M8 12h4M10 10v4M16 11h.01M18 13h.01" />
    </SystemIcon>
  ),
  docs: (
    <SystemIcon>
      <path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v4h4M8 11h8M8 15h8" />
    </SystemIcon>
  ),
};

export default function BigScreenSystem() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const SECTIONS: { id: SystemSection; label: string; icon: ReactNode }[] = [
    { id: "downloads", label: t("bigscreen.system.menuDownloads"), icon: SYSTEM_ICONS.downloads },
    { id: "storage", label: t("bigscreen.system.menuStorage"), icon: SYSTEM_ICONS.storage },
    { id: "achievements", label: t("bigscreen.system.menuAchievements"), icon: SYSTEM_ICONS.achievements },
    { id: "settings", label: t("bigscreen.system.menuPreferences"), icon: SYSTEM_ICONS.settings },
    // These three are full routes, not in-hub sub-views — selecting one
    // navigates to its own bigscreen page (wired in the registry).
    { id: "mods", label: t("nav.mods"), icon: SYSTEM_ICONS.mods },
    { id: "emulators", label: t("nav.emulators"), icon: SYSTEM_ICONS.emulators },
    { id: "docs", label: t("nav.docs"), icon: SYSTEM_ICONS.docs },
  ];

  // Find initial section from current pathname
  const initialSection = useMemo<SystemSection>(() => {
    const path = location.pathname;
    if (path.startsWith("/storage")) return "storage";
    if (path.startsWith("/downloads")) return "downloads";
    if (path.startsWith("/achievements")) return "achievements";
    if (path.startsWith("/mods")) return "mods";
    if (path.startsWith("/emulators")) return "emulators";
    if (path.startsWith("/docs")) return "docs";
    return "settings";
  }, [location.pathname]);

  const [activeSection, setActiveSection] = useState<SystemSection>(initialSection);

  // Sync active section with route changes (header/deep-linking). Only the
  // in-hub sub-views keep the hub mounted; /mods, /emulators and /docs swap
  // to their own pages, so the highlights below cover the hub routes only.
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
          {SECTIONS.map((sec) => (
            <SystemMenuItem
              key={sec.id}
              section={sec}
              isActive={activeSection === sec.id}
              onSelect={() => handleSelectSection(sec.id)}
            />
          ))}
        </div>
      </div>

      {/* Right Details View Pane */}
      <div className="bigscreen-system-right-pane">
        {activeSection === "downloads" && <DownloadsView />}
        {activeSection === "storage" && <StorageView />}
        {activeSection === "achievements" && <AchievementsHubView />}
        {activeSection === "settings" && <SettingsView />}
        {/* mods / emulators / docs navigate to their own pages, so the hub
            unmounts before this pane needs content for them. */}
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
          {downloads.map((dl) => (
            <DownloadRow
              key={dl.id}
              dl={dl}
              onPause={() => handlePause(dl.id)}
              onResume={() => handleResume(dl.id)}
              onCancel={() => handleCancel(dl.id)}
            />
          ))}
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
          {gamesWithAchievements.map(({ game, data }) => (
            <AchievementGameRow
              key={game.id}
              game={game}
              data={data}
              onOpen={() => navigate(`/library/${game.id}`)}
            />
          ))}
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

// ── Focusable sub-components ──────────────────────────────────────
// Each owns its useFocusable calls unconditionally (rules-of-hooks).
// The earlier inline hooks inside `SECTIONS.map` / `downloads.map` /
// `gamesWithAchievements.map` were hook-in-map violations — safe only
// because those lists happened to be constant. Extracting them makes
// the hook count stable regardless of list shape.

function SystemMenuItem({
  section,
  isActive,
  onSelect,
}: {
  section: { id: SystemSection; label: string; icon: ReactNode };
  isActive: boolean;
  onSelect: () => void;
}) {
  const focusProps = useFocusable(onSelect);

  return (
    <button
      type="button"
      aria-selected={isActive}
      className={`bigscreen-system-menu-item ${isActive ? "active" : ""}`}
      {...focusProps}
    >
      <span className="menu-item-icon">{section.icon}</span>
      <span className="menu-item-label">{section.label}</span>
    </button>
  );
}

function DownloadRow({
  dl,
  onPause,
  onResume,
  onCancel,
}: {
  dl: TorrentDownload;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const resumeProps = useFocusable(onResume);
  const pauseProps = useFocusable(onPause);
  const cancelProps = useFocusable(onCancel);

  const isDownloading =
    dl.status.kind === "downloading" || dl.status.kind === "fetchingMetadata";

  // Human status label — the six shared kinds reuse the desktop
  // `download.status.*` keys; `seeding` has no desktop key yet.
  const statusLabel =
    dl.status.kind === "seeding"
      ? t("bigscreen.system.statusSeeding")
      : t(`download.status.${dl.status.kind}`);

  return (
    <div className="system-download-row">
      <div className="dl-row-header">
        <span className="dl-name">{dl.name}</span>
        <span className="dl-status-badge">{statusLabel}</span>
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
}

function AchievementGameRow({
  game,
  data,
  onOpen,
}: {
  game: Game;
  data: GameAchievementData | null;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const cardProps = useFocusable(onOpen);
  const pct = data ? Math.round((data.unlocked / data.total) * 100) : 0;

  return (
    <div className="system-achievement-game-row" {...cardProps}>
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
}
