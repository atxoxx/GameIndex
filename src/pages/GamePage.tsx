import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
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
  ScreenshotsSection,
  VideosSection,
  SystemRequirementsCard,
} from "../components/game";
import { GameActivityTab } from "../components/game/GameActivityTab";
import { Button, ConfirmModal } from "../components/ui";
import {
  IconOverview,
  IconMessageSquare,
  IconActivity,
  IconTrophy,
  IconWrench,
  IconGlobe,
} from "../components/game/icons";

type GamePageTab = "overview" | "reviews" | "activity" | "achievements" | "mods" | "weblinks";

const VALID_TABS = new Set<GamePageTab>([
  "overview",
  "reviews",
  "activity",
  "achievements",
  "mods",
  "weblinks",
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

  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Tab synchronization with URL search query param
  const urlTab = searchParams.get("tab") as GamePageTab | null;
  const activeTab: GamePageTab = urlTab && VALID_TABS.has(urlTab) ? urlTab : "overview";

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

  // Lazy metadata auto-enrichment on mount
  const enrichmentStartedRef = useRef(false);
  useEffect(() => {
    if (enrichmentStartedRef.current) return;
    if (game.metadataSource === NO_IGDB_MATCH_SOURCE && game.igdbId == null) return;
    if (!game.name) return;

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

  // Tab definitions with icons and live counts
  const tabs = useMemo(
    () => [
      { id: "overview" as const, label: t("game.tab.overview"), icon: IconOverview },
      { id: "reviews" as const, label: t("game.tab.reviews"), icon: IconMessageSquare },
      { id: "activity" as const, label: t("game.tab.activity"), icon: IconActivity },
      {
        id: "achievements" as const,
        label: t("game.tab.achievements"),
        icon: IconTrophy,
        count: game.steamAchievements?.length ?? null,
      },
      { id: "mods" as const, label: t("game.tab.mods"), icon: IconWrench },
      {
        id: "weblinks" as const,
        label: t("game.tab.weblinks"),
        icon: IconGlobe,
        count: game.websites?.length ?? null,
      },
    ],
    [t, game.steamAchievements, game.websites]
  );

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
        activeTab={activeTab}
        onChange={handleTabChange}
      />

      {/* Tab Content Panels */}
      {activeTab === "overview" && (
        <div className="game-content-grid">
          <div className="game-main-col">
            <AboutSection game={game} />
            <SystemRequirementsCard steamAppId={game.steamAppId ?? null} />
            <StorylineSection game={game} />
            <ScreenshotsSection
              game={game}
              onOpen={handleOpenScreenshot}
            />
            <VideosSection game={game} />

            <GameRelationsCard
              mode="library"
              currentGame={game}
              currentGameId={game.id}
              similarGames={game.similarGames}
              collectionId={game.collectionId}
              collectionName={game.collection}
            />
          </div>

          <div className="game-side-col">
            <div className="side-group">
              <InfoKpiCard
                game={game}
                sizeUnit={sizeUnit}
                onEditSize={() => setEditing(true)}
              />
              <RatingsKpiCard game={game} />
              <TimeToBeatCard game={game} />
            </div>
            <div className="side-group">
              <SpecsCard game={game} />
              <ProtonDBCard steamAppId={game.steamAppId} />
              <CrackWatchCard gameName={game.name} appId={game.steamAppId} />
            </div>
            <div className="side-group">
              <ReleasesCard game={game} />
              <LanguagesSection game={game} />
            </div>
          </div>
        </div>
      )}

      {activeTab === "reviews" && <ReviewsTab game={game} />}

      {activeTab === "activity" && <GameActivityTab game={game} />}

      {activeTab === "weblinks" && (
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

      {activeTab === "achievements" && <AchievementsTab game={game} />}

      {activeTab === "mods" && (
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
  const { getGame, setSelectedGameId } = useGames();

  useEffect(() => {
    if (gameId) {
      setSelectedGameId(gameId);
    }
  }, [gameId, setSelectedGameId]);

  const game = gameId ? getGame(gameId) : undefined;

  if (!game) {
    return <GameNotFound />;
  }

  return <GameDetail key={game.id} game={game} />;
}
