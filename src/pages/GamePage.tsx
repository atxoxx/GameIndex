import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useGames, useGameById, NO_IGDB_MATCH_SOURCE } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { useSettings, type DetailSectionKey } from "../context/SettingsContext";
import { useActivity } from "../context/ActivityContext";
import { EditGameModal } from "../components/game/EditGameModal";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { useSteamAppId } from "../hooks/useSteamAppId";
import { type Game } from "../types/game";
import WebLinksTab from "../components/WebLinksTab";
import ReviewsTab from "../components/ReviewsTab";
import CrackWatchCard from "../components/CrackWatchCard";
import ProtonDBCard from "../components/ProtonDBCard";
import AchievementsTab from "../components/AchievementsTab";
import ModsTab from "../components/mods/ModsTab";
import GameRelationsCard from "../components/GameRelationsCard";
import {
  GameHero,
  GameTabs,
  GameQuickActions,
  ImageLightbox,
  InfoKpiCard,
  RatingsKpiCard,
  SpecsCard,
  TimeToBeatCard,
  ReleasesCard,
  LanguagesSection,
  AboutSection,
  StorylineSection,
  NotesSection,
  ScreenshotsSection,
  VideosSection,
  SystemRequirementsCard,
  DetailSectionsHiddenNote,
} from "../components/game";
import { GameActivityTab } from "../components/game/GameActivityTab";
import GameNewsTab from "../components/game/GameNewsTab";
import "../styles/activity.css";
import "../styles/achievements.css";
import "../styles/reviews.css";
import "../styles/game-news.css";
import "../styles/weblinks.css";
import { useAchievements } from "../context/AchievementContext";
import { Button, ConfirmModal } from "../components/ui";
import {
  IconOverview,
  IconMessageSquare,
  IconActivity,
  IconTrophy,
  IconWrench,
  IconGlobe,
  IconNewspaper,
} from "../components/game/icons";

type GamePageTab =
  | "overview"
  | "reviews"
  | "activity"
  | "achievements"
  | "mods"
  | "weblinks"
  | "news";

const VALID_TABS = new Set<GamePageTab>([
  "overview",
  "reviews",
  "activity",
  "achievements",
  "mods",
  "weblinks",
  "news",
]);

function GameNotFound() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  return (
    <div className="main-empty">
      <svg
        className="main-empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <h2 className="main-empty-title">{t("game.notFoundTitle")}</h2>
      <p className="main-empty-subtitle">{t("game.notFoundSubtitle")}</p>
      <Button variant="ghost" size="sm" onClick={() => navigate("/library")}>
        {t("page.game.backToLibrary")}
      </Button>
    </div>
  );
}

function GameDetail({ game }: { game: Game }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { launchGame, enrichGameMetadata, removeGame, updateGame } = useGames();
  const { unit: sizeUnit } = useSizeUnit();
  const { appId: heroSteamAppId } = useSteamAppId(game);
  const { isSimpleUi, detailSectionVisible } = useSettings();
  const { getGameAchievements } = useAchievements();

  // Achievement total from the active source (Steam / GOG / Epic / Retro /
  // manual), falling back to the legacy Steam-synced array for games that
  // predate the multi-source cache.
  const achievementTotal =
    getGameAchievements(game.id)?.total ?? game.steamAchievements?.length ?? null;

  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Tab synchronization with URL search query param
  const urlTab = searchParams.get("tab") as GamePageTab | null;
  const activeTab: GamePageTab = urlTab && VALID_TABS.has(urlTab) ? urlTab : "overview";

  // A tab is reachable unless it's a simple-UI-only exclusion or the user
  // disabled that detail section in Settings → Appearance.
  const isTabVisible = useCallback(
    (tab: GamePageTab): boolean => {
      if (tab === "overview") return true;
      if (isSimpleUi && (tab === "weblinks" || tab === "news")) return false;
      return detailSectionVisible[tab as DetailSectionKey];
    },
    [isSimpleUi, detailSectionVisible],
  );

  const effectiveTab: GamePageTab =
    activeTab !== "overview" && !isTabVisible(activeTab) ? "overview" : activeTab;

  const handleTabChange = useCallback(
    (newTab: GamePageTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (newTab === "overview") next.delete("tab");
          else next.set("tab", newTab);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // Screenshot Lightbox opener
  const handleOpenScreenshot = useCallback((_src: string, index?: number) => {
    setLightboxIndex(index ?? 0);
    setLightboxOpen(true);
  }, []);

  // Lazy metadata auto-enrichment on mount. `metadataSource` is persisted
  // by the enrichment pipeline — set to the real source (e.g. "IGDB") after
  // a successful fetch, or to NO_IGDB_MATCH_SOURCE when nothing matched.
  // So once metadata has been fetched for this game, don't re-reach for the
  // network on every page reopen (games that legitimately lack timeToBeat /
  // collection would otherwise trigger a redundant refetch each visit). The
  // only exception is a game marked no-match whose IGDB id later became
  // known — reaching out by id can un-gate it.
  const enrichmentStartedRef = useRef(false);
  useEffect(() => {
    if (enrichmentStartedRef.current) return;
    if (!game.name) return;
    const alreadyEnriched =
      !!game.metadataSource &&
      !(game.metadataSource === NO_IGDB_MATCH_SOURCE && game.igdbId != null);
    if (alreadyEnriched) return;

    const hasDescription = !!game.description;
    const missingTTB = !game.timeToBeat;
    const hasCollection = !!game.collection;
    const hasDeveloper = !!game.developer;
    const hasPublisher = !!game.publisher;
    const hasGenres = !!(game.genres && game.genres.length > 0);
    const hasAllRelationFields = hasCollection && hasDeveloper && hasPublisher && hasGenres;
    const missedCollectionId = !!game.collection && game.collectionId === undefined;

    if (hasDescription && !missingTTB && hasAllRelationFields && !missedCollectionId) {
      return;
    }

    enrichmentStartedRef.current = true;
    enrichGameMetadata(game.id, game.name, game.steamAppId).catch((err) =>
      console.error("Auto-enrichment failed:", err)
    );
  }, [
    game.id,
    game.name,
    game.steamAppId,
    game.description,
    game.timeToBeat,
    game.metadataSource,
    game.igdbId,
    game.collection,
    game.collectionId,
    game.developer,
    game.publisher,
    game.genres,
    enrichGameMetadata,
  ]);

  const handleLaunch = () => {
    launchGame(game);
  };

  const handleBack = () => {
    navigate("/library");
  };

  const handleConfirmRemove = () => {
    removeGame(game.id);
    showToast(t("game.removed", { name: game.name }), "info");
    navigate("/library");
  };

  const { getGameSessions } = useActivity();
  const gameSessions = useMemo(() => getGameSessions(game.id), [getGameSessions, game.id]);
  const sessionCount = gameSessions.length;

  // Tab definitions with icons and live counts
  const tabs = useMemo(() => {
    const allTabs = [
      { id: "overview" as const, label: t("game.tab.overview"), icon: IconOverview },
      { id: "reviews" as const, label: t("game.tab.reviews"), icon: IconMessageSquare },
      {
        id: "activity" as const,
        label: t("game.tab.activity"),
        icon: IconActivity,
        count: sessionCount > 0 ? sessionCount : null,
      },
      {
        id: "achievements" as const,
        label: t("game.tab.achievements"),
        icon: IconTrophy,
        count: achievementTotal,
      },
      { id: "mods" as const, label: t("game.tab.mods"), icon: IconWrench },
      {
        id: "weblinks" as const,
        label: t("game.tab.weblinks"),
        icon: IconGlobe,
        count: game.websites?.length ?? null,
      },
      { id: "news" as const, label: t("game.tab.news"), icon: IconNewspaper },
    ];
    return allTabs.filter((tab) => isTabVisible(tab.id));
  }, [t, achievementTotal, game.websites, isTabVisible]);

  return (
    <div className="game-page">
      {/* Top Bar with Return Link and Edit / Remove actions */}
      <div className="game-top-bar">
        <button
          className="game-back-link"
          onClick={handleBack}
          aria-label={t("gamePage.returnToLibrary")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>{t("page.game.returnToLibrary")}</span>
        </button>

        <div className="game-top-bar__actions">
          <GameQuickActions
            game={game}
            gameName={game.name}
            steamAppId={game.steamAppId}
            executablePath={game.path}
            onEdit={() => setEditing(true)}
            onRemove={() => setShowRemoveConfirm(true)}
          />
        </div>
      </div>

      {/* Hero Banner */}
      <GameHero
        game={game}
        steamAppId={heroSteamAppId}
        onLaunch={handleLaunch}
      />

      {/* Sticky Segmented Tabs with Sliding Indicator */}
      <GameTabs
        tabs={tabs}
        activeTab={effectiveTab}
        onChange={handleTabChange}
      />

      {/* Tab Content Panels */}
      {effectiveTab === "overview" && (
        <div className="game-content-grid">
          <div className="game-main-col">
            <DetailSectionsHiddenNote
              sections={[
                "systemRequirements",
                "gameRelations",
                "timeToBeat",
                "protonDb",
                "releases",
                "reviews",
                "activity",
                "achievements",
                "mods",
                "weblinks",
                "news",
              ]}
            />
            <AboutSection game={game} />
            <NotesSection game={game} />
            {detailSectionVisible.systemRequirements && (
              <SystemRequirementsCard steamAppId={game.steamAppId ?? null} />
            )}
            <div className="ui-complete-only">
              <StorylineSection game={game} />
            </div>
            <ScreenshotsSection
              game={game}
              onOpen={handleOpenScreenshot}
            />
            <VideosSection game={game} />

            <div className="ui-complete-only">
              {detailSectionVisible.gameRelations && (
                <GameRelationsCard
                  mode="library"
                  currentGame={game}
                  currentGameId={game.id}
                  similarGames={game.similarGames}
                  collectionId={game.collectionId}
                  collectionName={game.collection}
                />
              )}
            </div>
          </div>

          <div className="game-side-col">
            <div className="side-group">
              <InfoKpiCard
                game={game}
                sizeUnit={sizeUnit}
                onEditSize={() => setEditing(true)}
              />
              <RatingsKpiCard game={game} />
              {detailSectionVisible.timeToBeat && <TimeToBeatCard game={game} />}
            </div>
            <div className="side-group ui-complete-only">
              <SpecsCard game={game} />
              {detailSectionVisible.protonDb && (
                <ProtonDBCard steamAppId={game.steamAppId} />
              )}
              <CrackWatchCard gameName={game.name} appId={game.steamAppId} />
            </div>
            <div className="side-group ui-complete-only">
              {detailSectionVisible.releases && <ReleasesCard game={game} />}
              <LanguagesSection game={game} />
            </div>
          </div>
        </div>
      )}

      {effectiveTab === "reviews" && <ReviewsTab game={game} />}

      {effectiveTab === "activity" && <GameActivityTab game={game} />}

      {effectiveTab === "weblinks" && (
        <WebLinksTab
          game={game}
          visible={!editing && !lightboxOpen}
          onWebsitesChange={(websites) =>
            updateGame(game.id, {
              websites: websites.length > 0 ? websites : undefined,
            })
          }
        />
      )}

      {effectiveTab === "achievements" && <AchievementsTab game={game} />}

      {effectiveTab === "mods" && (
        <ModsTab
          game={game}
          onModsSized={(info) =>
            updateGame(game.id, {
              modsSizeBytes: info.totalBytes > 0 ? info.totalBytes : undefined,
              modsFolder: info.folder,
              modsDetectedAt:
                info.totalBytes > 0 ? new Date().toISOString() : undefined,
            })
          }
        />
      )}

      {effectiveTab === "news" && <GameNewsTab game={game} />}

      {/* Edit Game Modal */}
      {editing && <EditGameModal game={game} onClose={() => setEditing(false)} />}

      {/* Unified Image Lightbox */}
      <ImageLightbox
        images={game.screenshots || []}
        currentIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onSelectIndex={setLightboxIndex}
        title={game.name}
      />

      {/* Confirm Remove Modal */}
      <ConfirmModal
        open={showRemoveConfirm}
        title={t("game.removeConfirmTitle", { name: game.name })}
        message={t("gamePage.removeConfirmBody")}
        confirmLabel={t("common.remove")}
        cancelLabel={t("game.keep")}
        onConfirm={handleConfirmRemove}
        onCancel={() => setShowRemoveConfirm(false)}
      />
    </div>
  );
}

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { setSelectedGameId } = useGames();

  useEffect(() => {
    if (gameId) {
      setSelectedGameId(gameId);
    }
  }, [gameId, setSelectedGameId]);

  // Narrow per-game subscription: the page (and its whole detail subtree)
  // re-renders only when THIS game's record changes, not on any unrelated
  // library mutation (watcher exit bumps `lastPlayed` on other titles,
  // enrichments update covers, etc.).
  const game = useGameById(gameId ?? "");

  if (!game) {
    return <GameNotFound />;
  }

  return <GameDetail key={game.id} game={game} />;
}
