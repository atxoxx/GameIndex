// Shared game-detail logic and section bodies.
//
// The five layouts compose their own pages (hero, section navigation,
// information order), but the underlying capabilities are identical:
// launch, install, force-close, trailer, download finder, favourite,
// achievements, reviews, activity, specs, media and related games.
// Everything here is presentation-neutral.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Activity,
  BadgeCheck,
  Heart,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  ListTree,
  MoreHorizontal,
  Play,
  Square,
  Star,
} from "lucide-react";
import type { Game } from "../../../../types/game";
import {
  PLAY_STATUS_DETAILS,
  formatPlayTime,
  gameDisplayName,
} from "../../../../types/game";
import { NO_IGDB_MATCH_SOURCE, useGames } from "../../../../context/GameContext";
import { useLanguage } from "../../../../context/LanguageContext";
import { useToast } from "../../../../context/ToastContext";
import { useActivity } from "../../../../context/ActivityContext";
import { useSteamAppId } from "../../../../hooks/useSteamAppId";
import { useGameBackdropArt } from "../../../../hooks/useGameBackdropArt";
import { useGamepad } from "../../../../hooks/GamepadProvider";
import { usePersistedState } from "../../../../hooks/usePersistedState";
import { useFocusable } from "../../../../hooks/useFocusable";
import { bigScreenParentOf } from "../../../../bigscreen/registry";
import { extractYear, formatLastPlayedLocalized, isVideoUrl } from "../../bigscreenFormat";
import { cycleTabId, focusTabLanding } from "../../../game/bigscreenGameTabs";
import BigScreenTabPanel from "../../BigScreenTabPanel";
import BigScreenLightbox from "../../BigScreenLightbox";
import DownloadModal from "../../../DownloadModal";
import StorylineSection from "../../../game/StorylineSection";
import AboutSection from "../../../game/AboutSection";
import HandheldReadinessStrip from "../../../game/HandheldReadinessStrip";
import SpecsCard from "../../../game/SpecsCard";
import ReleasesCard from "../../../game/ReleasesCard";
import LanguagesSection from "../../../game/LanguagesSection";
import ScreenshotsSection from "../../../game/ScreenshotsSection";
import VideosSection from "../../../game/VideosSection";
import SystemRequirementsCard from "../../../game/SystemRequirementsCard";
import RatingsKpiCard from "../../../game/RatingsKpiCard";
import TimeToBeatCard from "../../../game/TimeToBeatCard";
import BigScreenRailScroller from "../../../game/BigScreenRailScroller";
import CrackWatchCard from "../../../CrackWatchCard";
import GameRelationsCard from "../../../GameRelationsCard";
import ReviewsTab from "../../../ReviewsTab";
import AchievementsTab from "../../../AchievementsTab";
import WebLinksTab from "../../../WebLinksTab";
import PlayerCountBadge from "../../../PlayerCountBadge";
import { StatBand, StatCell } from "../../../activity";
import { formatSessionClockRange, formatSessionDay } from "../../../../utils/activity/sessionTime";
import { openUrl } from "@tauri-apps/plugin-opener";
import "../../../../styles/activity.css";
import "../../../../styles/achievements.css";
import "../../../../styles/reviews.css";
import "../../../../styles/weblinks.css";

export type DetailTabId =
  | "overview"
  | "media"
  | "specs"
  | "achievements"
  | "reviews"
  | "activity"
  | "more";

export interface DetailTabDef {
  id: DetailTabId;
  label: string;
  icon: ReactNode;
  count?: number | null;
}

const TAB_IDS: DetailTabId[] = [
  "overview",
  "media",
  "specs",
  "achievements",
  "reviews",
  "activity",
  "more",
];

const ICON_SIZE = 18;

function icon(node: ReactNode) {
  return <span className="bstd-tab-glyph">{node}</span>;
}

/**
 * Everything a detail layout needs. Shared so the five pages cannot
 * drift on behaviour: same tab set, same launch/install/favourite
 * semantics, same focus landing and bumper cycling.
 */
export function useDetailController(game: Game, fallbackPath: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const gamepad = useGamepad();
  const { runningGameIds, launchGame, forceCloseGame, loadGameDetail, enrichGameMetadata, updateGame } =
    useGames();
  const { showToast } = useToast();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadGameDetail(game.id);
  }, [game.id, loadGameDetail]);

  const { appId: steamAppId } = useSteamAppId(game);
  const resolvedSteamAppId =
    typeof steamAppId === "number" ? steamAppId : game.steamAppId ?? null;
  const backdrop = useGameBackdropArt(game);

  const [activeTab, setActiveTab] = usePersistedState<DetailTabId>(
    "gamelib.bigscreen.game_page.tab_v2",
    "overview",
    TAB_IDS,
  );
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ tab: DetailTabId; nonce: number } | null>(null);
  const focusNonceRef = useRef(0);

  const isRunning = runningGameIds.includes(game.id);
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];
  const achTotal = game.steamAchievements?.length ?? 0;
  const achCount =
    game.steamAchievements?.filter((achievement) => achievement.achieved).length ?? 0;
  const playableTrailer = useMemo(
    () => (game.videos ?? []).find(isVideoUrl) ?? null,
    [game.videos],
  );
  const showInstall =
    !game.installed && game.platform === "Steam" && !!game.steamAppId;

  useEffect(() => {
    if (isRunning) return;
    setIsClosing(false);
  }, [isRunning]);

  useEffect(() => {
    const alreadyEnriched =
      !!game.metadataSource &&
      !(game.metadataSource === NO_IGDB_MATCH_SOURCE && game.igdbId != null);
    if (alreadyEnriched) return;
    enrichGameMetadata(game.id, game.name, game.steamAppId).catch((error) =>
      console.warn("Failed to enrich metadata on the Big Screen game page:", error),
    );
  }, [game.id, game.name, game.steamAppId, enrichGameMetadata]);

  const tabs = useMemo<DetailTabDef[]>(() => {
    const list: DetailTabDef[] = [
      { id: "overview", label: t("game.tab.overview"), icon: icon(<Info size={ICON_SIZE} />) },
      { id: "media", label: t("game.tab.media"), icon: icon(<ImageIcon size={ICON_SIZE} />) },
      { id: "specs", label: t("game.tab.specs"), icon: icon(<ListTree size={ICON_SIZE} />) },
    ];
    if (resolvedSteamAppId != null) {
      list.push({
        id: "achievements",
        label: t("game.tab.achievements"),
        icon: icon(<BadgeCheck size={ICON_SIZE} />),
        count: achCount,
      });
    }
    list.push(
      { id: "reviews", label: t("game.tab.reviews"), icon: icon(<Star size={ICON_SIZE} />) },
      { id: "activity", label: t("game.tab.activity"), icon: icon(<Activity size={ICON_SIZE} />) },
      { id: "more", label: t("game.tab.more"), icon: icon(<MoreHorizontal size={ICON_SIZE} />) },
    );
    return list;
  }, [achCount, resolvedSteamAppId, t]);

  // Land on the primary action, not the back chip.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLElement>('[data-primary-action="true"]')
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [game.id]);

  useEffect(() => {
    if (!focusRequest) return;
    focusTabLanding({
      root: rootRef.current,
      tabId: focusRequest.tab,
      focusFirst: gamepad.focusFirst,
    });
  }, [focusRequest, gamepad.focusFirst]);

  // A persisted tab can disappear when a game has no Steam achievements.
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, setActiveTab, tabs]);

  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      if (lightbox) return;
      setActiveTab((previous) =>
        cycleTabId(activeTabIds(tabs), previous, direction),
      );
    });
  }, [gamepad.registerTabCycler, lightbox, setActiveTab, tabs]);

  const enterContent = useCallback((tab: DetailTabId) => {
    focusNonceRef.current += 1;
    setFocusRequest({ tab, nonce: focusNonceRef.current });
  }, []);

  const onBack = useCallback(() => {
    navigate(bigScreenParentOf(location.pathname) ?? fallbackPath);
  }, [fallbackPath, location.pathname, navigate]);

  const handlePlay = useCallback(() => launchGame(game), [game, launchGame]);

  const handleForceClose = useCallback(() => {
    if (!isRunning) return;
    setIsClosing(true);
    void forceCloseGame(game);
  }, [forceCloseGame, game, isRunning]);

  const handleInstall = useCallback(() => {
    if (!game.steamAppId) return;
    openUrl(`steam://install/${game.steamAppId}`).catch((error) =>
      console.warn("Failed to open Steam install:", error),
    );
  }, [game.steamAppId]);

  const handleFavorite = useCallback(() => {
    const next = !game.favorite;
    updateGame(game.id, { favorite: next });
    showToast(
      t(next ? "commandPalette.addedToFavorites" : "commandPalette.removedFromFavorites"),
      "info",
    );
  }, [game.favorite, game.id, showToast, t, updateGame]);

  return {
    game,
    tabs,
    activeTab,
    setActiveTab,
    enterContent,
    rootRef,
    backdrop,
    resolvedSteamAppId,
    isRunning,
    isClosing,
    status,
    achTotal,
    achCount,
    playableTrailer,
    showInstall,
    lightbox,
    setLightbox,
    downloadOpen,
    setDownloadOpen,
    handlePlay,
    handleForceClose,
    handleInstall,
    handleFavorite,
    onBack,
  };
}

export type DetailController = ReturnType<typeof useDetailController>;

function activeTabIds(tabs: DetailTabDef[]): DetailTabId[] {
  return tabs.map((tab) => tab.id);
}

// ── Section navigation ─────────────────────────────────────────────

export type SectionNavVariant = "bar" | "tiles" | "list" | "icons" | "segments";

export function DetailSectionNav({
  controller,
  variant,
  railId,
}: {
  controller: DetailController;
  variant: SectionNavVariant;
  railId: string;
}) {
  const { t } = useLanguage();
  const { tabs, activeTab, setActiveTab, enterContent } = controller;
  const didMountRef = useRef(false);

  // Bumper cycling changes the active section without moving focus. Park
  // focus on the strip so the next D-pad press starts from the section
  // row instead of an unrelated control. A/click is followed by the
  // page's content-entry effect, which wins because it runs last.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    document
      .getElementById(`bigscreen-tab-${activeTab}`)
      ?.focus({ preventScroll: true });
  }, [activeTab]);

  return (
    <div
      className="bstd-nav"
      data-variant={variant}
      data-axis={variant === "list" ? "y" : undefined}
      role="tablist"
      aria-label={t("bigscreen.tabbar.tabs")}
      data-rail-id={railId}
    >
      {tabs.map((tab) => (
        <SectionTab
          key={tab.id}
          tab={tab}
          active={tab.id === activeTab}
          onSelect={() => {
            setActiveTab(tab.id);
            enterContent(tab.id);
          }}
        />
      ))}
    </div>
  );
}

function SectionTab({
  tab,
  active,
  onSelect,
}: {
  tab: DetailTabDef;
  active: boolean;
  onSelect: () => void;
}) {
  const props = useFocusable(onSelect);
  return (
    <button
      type="button"
      role="tab"
      id={`bigscreen-tab-${tab.id}`}
      aria-selected={active}
      aria-controls={`bigscreen-tabpanel-${tab.id}`}
      className="bstd-nav-tab"
      data-active={active ? "true" : undefined}
      {...props}
    >
      {tab.icon}
      <span className="bstd-nav-label">{tab.label}</span>
      {typeof tab.count === "number" && tab.count > 0 ? (
        <span className="bstd-nav-count">{tab.count}</span>
      ) : null}
    </button>
  );
}

// ── Panels ─────────────────────────────────────────────────────────

export function DetailPanels({
  controller,
  overview,
}: {
  controller: DetailController;
  overview: ReactNode;
}) {
  const { game, tabs, activeTab } = controller;
  const { t } = useLanguage();
  const available = new Set(tabs.map((tab) => tab.id));

  return (
    <div className="bstd-panels">
      <BigScreenTabPanel tabId="overview" activeTab={activeTab}>
        {overview}
      </BigScreenTabPanel>
      <BigScreenTabPanel tabId="media" activeTab={activeTab}>
        <MediaBody
          game={game}
          onOpenLightbox={controller.setLightbox}
          onFindDownload={() => controller.setDownloadOpen(true)}
        />
      </BigScreenTabPanel>
      <BigScreenTabPanel tabId="specs" activeTab={activeTab}>
        <SpecsBody game={game} />
      </BigScreenTabPanel>
      {available.has("achievements") ? (
        <BigScreenTabPanel tabId="achievements" activeTab={activeTab}>
          <div className="bstd-embed">
            <AchievementsTab game={game} />
          </div>
        </BigScreenTabPanel>
      ) : null}
      <BigScreenTabPanel tabId="reviews" activeTab={activeTab}>
        <div className="bstd-embed">
          <ReviewsTab game={game} />
        </div>
      </BigScreenTabPanel>
      <BigScreenTabPanel tabId="activity" activeTab={activeTab}>
        <ActivityBody game={game} />
      </BigScreenTabPanel>
      <BigScreenTabPanel tabId="more" activeTab={activeTab}>
        <div className="bstd-embed bstd-embed--stack">
          <GameRelationsCard
            mode="library"
            currentGame={game}
            currentGameId={game.id}
            similarGames={game.similarGames}
            collectionId={game.collectionId}
            collectionName={game.collection}
          />
          <WebLinksTab game={game} visible />
          <p className="bstd-sr-note">{t("bigscreen.detail.relatedHint")}</p>
        </div>
      </BigScreenTabPanel>
    </div>
  );
}

// ── Shared overview blocks ─────────────────────────────────────────

export function DetailProse({ game }: { game: Game }) {
  return (
    <div className="bstd-prose">
      <StorylineSection game={game} />
      <AboutSection game={game} />
      <HandheldReadinessStrip game={game} />
    </div>
  );
}

export function DetailFactGrid({ game }: { game: Game }) {
  const { t } = useLanguage();
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];
  const year = extractYear(game.releaseDate);

  return (
    <dl className="bstd-facts">
      <div>
        <dt>{t("hero.playTime")}</dt>
        <dd>{game.playTime || "0h"}</dd>
      </div>
      <div>
        <dt>{t("game.lastPlayed")}</dt>
        <dd>{formatLastPlayedLocalized(game.lastPlayed ?? 0, t)}</dd>
      </div>
      <div>
        <dt>{t("hero.status")}</dt>
        <dd>
          <i style={{ background: status.color }} aria-hidden="true" />
          {t(status.labelKey)}
        </dd>
      </div>
      {year ? (
        <div>
          <dt>{t("gameInfo.releaseDate")}</dt>
          <dd>{year}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function DetailChips({ game }: { game: Game }) {
  const { t } = useLanguage();
  const year = extractYear(game.releaseDate);
  return (
    <div className="bstd-chips">
      <span className="bst-chip bst-chip--brand">{game.platform}</span>
      <span className="bst-chip">
        {game.installed ? t("game.readyToPlay") : t("game.notInstalled")}
      </span>
      {year ? <span className="bst-chip">{year}</span> : null}
      {game.developer ? <span className="bst-chip">{game.developer}</span> : null}
    </div>
  );
}

export function DetailRail({ game }: { game: Game }) {  const { t } = useLanguage();
  const achievements = game.steamAchievements;
  const unlocked = achievements?.filter((entry) => entry.achieved).length ?? 0;
  const total = achievements?.length ?? 0;
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : null;
  const hasTimeToBeat =
    !!game.timeToBeat &&
    ((game.timeToBeat.normally ?? 0) > 0 ||
      (game.timeToBeat.completely ?? 0) > 0 ||
      (game.timeToBeat.hastily ?? 0) > 0);

  return (
    <aside className="bstd-rail" aria-label={t("bigscreen.overview.rail")}>
      {percent != null ? (
        <section className="bstd-card">
          <header>
            <span>{t("achievementsPage.achievements")}</span>
            <b>
              {unlocked} / {total}
            </b>
          </header>
          <div
            className="bstd-progress"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <p>{percent}%</p>
        </section>
      ) : null}

      {game.igdbRating != null || game.criticRating != null ? (
        <section className="bstd-card">
          <RatingsKpiCard game={game} />
        </section>
      ) : null}

      {game.genres && game.genres.length > 0 ? (
        <section className="bstd-card">
          <h3>{t("bigscreen.overview.genres")}</h3>
          <div className="bstd-tags">
            {game.genres.map((genre) => (
              <span key={genre}>{genre}</span>
            ))}
          </div>
        </section>
      ) : null}

      {hasTimeToBeat ? (
        <section className="bstd-card">
          <TimeToBeatCard game={game} />
        </section>
      ) : null}

      {game.developer || game.publisher || game.franchise || game.collection ? (
        <section className="bstd-card">
          {game.developer ? (
            <Row label={t("bigscreen.gameHub.developer")} value={game.developer} />
          ) : null}
          {game.publisher ? (
            <Row label={t("bigscreen.gameHub.publisher")} value={game.publisher} />
          ) : null}
          {game.franchise ? (
            <Row label={t("info.franchise")} value={game.franchise} />
          ) : null}
          {game.collection ? (
            <Row label={t("bigscreen.overview.collection")} value={game.collection} />
          ) : null}
        </section>
      ) : null}

      {game.languageSupports && game.languageSupports.length > 0 ? (
        <section className="bstd-card">
          <LanguagesSection game={game} />
        </section>
      ) : null}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="bstd-row">
      <span>{label}</span>
      <b title={value}>{value}</b>
    </div>
  );
}

// ── Tab bodies ─────────────────────────────────────────────────────

export function MediaBody({
  game,
  onOpenLightbox,
  onFindDownload,
}: {
  game: Game;
  onOpenLightbox: (src: string) => void;
  onFindDownload: () => void;
}) {
  const { t } = useLanguage();
  const hasScreenshots = !!game.screenshots?.length;
  const hasVideos = !!game.videos?.length;
  const downloadProps = useFocusable(onFindDownload);

  if (!hasScreenshots && !hasVideos) {
    return (
      <div className="bst-grid-empty">
        <ImageIcon size={56} aria-hidden="true" />
        <h3>{t("game.noMediaTitle")}</h3>
        <p>{t("game.noMediaSubtitle")}</p>
        <button
          type="button"
          className="bst-btn bst-btn--ghost"
          {...downloadProps}
        >
          {t("game.findDownload")}
        </button>
      </div>
    );
  }

  return (
    <div className="bstd-media">
      {hasScreenshots ? (
        <BigScreenRailScroller railId="game-media-screens" label={t("community.tab.screenshots")}>
          <ScreenshotsSection game={game} onOpen={onOpenLightbox} />
        </BigScreenRailScroller>
      ) : null}
      {hasVideos ? (
        <BigScreenRailScroller railId="game-media-videos" label={t("videos.title")}>
          <VideosSection game={game} />
        </BigScreenRailScroller>
      ) : null}
    </div>
  );
}

/** One horizontal screenshot strip for overview compositions. */
export function DetailMediaPeek({
  game,
  onOpen,
}: {
  game: Game;
  onOpen: (src: string) => void;
}) {
  const { t } = useLanguage();
  if (!game.screenshots || game.screenshots.length === 0) return null;
  return (
    <BigScreenRailScroller
      railId="game-overview-media"
      label={t("community.tab.screenshots")}
    >
      <ScreenshotsSection game={game} onOpen={onOpen} />
    </BigScreenRailScroller>
  );
}

export function SpecsBody({ game }: { game: Game }) {  return (
    <div className="bstd-specs">
      <div className="bstd-two-col">
        <div className="bstd-card">
          <SpecsCard game={game} />
        </div>
        <div className="bstd-card">
          <ReleasesCard game={game} />
        </div>
      </div>
      <div className="bstd-card">
        <SystemRequirementsCard
          steamAppId={typeof game.steamAppId === "number" ? game.steamAppId : null}
        />
      </div>
      <div className="bstd-card">
        <CrackWatchCard gameName={game.name} appId={game.steamAppId} />
      </div>
    </div>
  );
}

export function ActivityBody({ game }: { game: Game }) {
  const { t, language } = useLanguage();
  const { getGameSessions } = useActivity();
  const sessions = useMemo(
    () =>
      [...getGameSessions(game.id)].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
    [game.id, getGameSessions],
  );

  if (sessions.length === 0) {
    return (
      <div className="bst-grid-empty">
        <Activity size={56} aria-hidden="true" />
        <h3>{t("gameActivity.noSessionsTitle")}</h3>
        <p>{t("activityInsights.gameEmptyHint")}</p>
      </div>
    );
  }

  const totalMinutes = sessions.reduce((sum, session) => sum + session.durationMin, 0);
  const longest = sessions.reduce((max, session) => Math.max(max, session.durationMin), 0);
  const average = Math.round(totalMinutes / sessions.length);

  return (
    <div className="bstd-activity">
      <StatBand>
        <StatCell
          hero
          label={t("activityDash.totalPlaytime")}
          value={formatPlayTime(totalMinutes)}
          sub={t("activity.allTime")}
        />
        <StatCell
          label={t("activityDash.sessions")}
          value={sessions.length}
          sub={formatSessionDay(sessions[0], language)}
        />
        <StatCell
          label={t("activity.avgSession")}
          value={formatPlayTime(average)}
          sub={t("gameActivity.perSession")}
        />
        <StatCell label={t("activity.longestSession")} value={formatPlayTime(longest)} />
      </StatBand>
      <section className="bstd-card bstd-session-list">
        <h3>{t("activitySessions.recentSessions")}</h3>
        {sessions.slice(0, 8).map((session) => (
          <div className="bstd-session" key={session.id}>
            <span>{formatSessionDay(session, language, { weekday: "short", day: "numeric", month: "short" })}</span>
            <span>{formatSessionClockRange(session, language)}</span>
            <span>{formatPlayTime(session.durationMin)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

// ── Hero actions ───────────────────────────────────────────────────

export function DetailActions({ controller }: { controller: DetailController }) {
  const { t } = useLanguage();
  const {
    game,
    isRunning,
    isClosing,
    showInstall,
    playableTrailer,
    handlePlay,
    handleForceClose,
    handleInstall,
    handleFavorite,
  } = controller;

  const playProps = useFocusable(handlePlay);
  const installProps = useFocusable(handleInstall);
  const closeProps = useFocusable(handleForceClose);
  const trailerProps = useFocusable(() => {
    if (playableTrailer) controller.setLightbox(playableTrailer);
  });
  const downloadProps = useFocusable(() => controller.setDownloadOpen(true));
  const favoriteProps = useFocusable(handleFavorite);

  return (
    <div className="bstd-actions">
      {isRunning ? (
        <button
          type="button"
          className="bst-btn bst-btn--primary bst-btn--danger"
          disabled={isClosing}
          data-primary-action="true"
          {...closeProps}
        >
          <Square size={16} aria-hidden="true" />
          <span>{isClosing ? t("game.closing") : t("game.forceClose")}</span>
        </button>
      ) : showInstall ? (
        <button
          type="button"
          className="bst-btn bst-btn--primary"
          data-primary-action="true"
          {...installProps}
        >
          <span>{t("game.installViaSteam")}</span>
        </button>
      ) : (
        <button
          type="button"
          className="bst-btn bst-btn--primary"
          data-primary-action="true"
          data-bs-autofocus="true"
          {...playProps}
        >
          <Play size={16} fill="currentColor" aria-hidden="true" />
          <span>{t("game.play")}</span>
        </button>
      )}

      {playableTrailer ? (
        <button type="button" className="bst-btn bst-btn--ghost" {...trailerProps}>
          <Play size={14} aria-hidden="true" />
          <span>{t("game.trailer")}</span>
        </button>
      ) : null}

      <button type="button" className="bst-btn bst-btn--ghost" {...downloadProps}>
        <span>{t("game.findDownload")}</span>
      </button>

      <button
        type="button"
        className="bst-btn bst-btn--icon"
        data-active={game.favorite ? "true" : undefined}
        aria-pressed={!!game.favorite}
        aria-label={t(game.favorite ? "gameMenu.unfavorite" : "gameMenu.favorite")}
        title={t(game.favorite ? "gameMenu.unfavorite" : "gameMenu.favorite")}
        {...favoriteProps}
      >
        <Heart size={16} fill={game.favorite ? "currentColor" : "none"} aria-hidden="true" />
      </button>
    </div>
  );
}

export function DetailBack({ onBack }: { onBack: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onBack);
  return (
    <button
      type="button"
      className="bstd-back"
      aria-label={t("page.game.backToLibrary")}
      {...props}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span>{t("common.back")}</span>
    </button>
  );
}

/** Hero meta line shared by the detail layouts. */
export function DetailMeta({ game }: { game: Game }) {
  const { t } = useLanguage();
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];
  return (
    <div className="bstd-meta">
      <span className="bst-chip bst-chip--brand">{game.platform}</span>
      <span className="bst-chip">
        <i className="bst-chip-dot" style={{ background: status.color }} aria-hidden="true" />
        {t(status.labelKey)}
      </span>
      {game.installed ? (
        <span className="bst-chip bst-chip--ok">{t("game.readyToPlay")}</span>
      ) : (
        <span className="bst-chip">{t("game.notInstalled")}</span>
      )}
      {game.playTime ? <span className="bst-chip">{game.playTime}</span> : null}
    </div>
  );
}

/** Shared not-found surface. */
export function DetailNotFound({ onBack }: { onBack: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onBack);
  return (
    <div className="bst-grid-empty bstd-notfound">
      <LayoutGrid size={56} aria-hidden="true" />
      <h3>{t("bigscreen.gameHub.gameNotFound")}</h3>
      <button type="button" className="bst-btn bst-btn--ghost" data-bs-autofocus="true" {...props}>
        {t("bigscreen.gameHub.goBack")}
      </button>
    </div>
  );
}

export function DetailOverlays({ controller }: { controller: DetailController }) {
  const { game } = controller;
  return (
    <>
      {controller.downloadOpen ? (
        <DownloadModal
          gameName={game.name}
          gameId={game.id}
          gamePoster={game.coverSourceUrl ?? game.bannerUrl ?? game.coverArtUrl}
          steamAppId={game.steamAppId}
          onClose={() => controller.setDownloadOpen(false)}
        />
      ) : null}
      <BigScreenLightbox src={controller.lightbox} onClose={() => controller.setLightbox(null)} />
    </>
  );
}

/** Player-count badge used in the dense header (Steam dossier). */
export function DetailPlayers({ appId }: { appId: number | null }) {
  const { t } = useLanguage();
  if (appId == null) return null;
  return (
    <span className="bstd-players">
      <PlayerCountBadge appId={appId} interactive={false} />
      {t("bigscreen.store.onSteam")}
    </span>
  );
}

/** Small helper used by the not-found path and the layouts' titles. */
export function detailTitle(game: Game): string {
  return gameDisplayName(game);
}

export const detailIcons = { Star, Heart, Play, LayoutGrid };
