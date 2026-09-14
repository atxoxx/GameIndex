import { useCallback, useEffect, useState, useRef, useMemo, type ReactNode } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useGames, useGameById, NO_IGDB_MATCH_SOURCE } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import {
  useSettings,
  useDetailTabOrder,
  useDetailTopBarLayout,
  type DetailSectionKey,
} from "../context/SettingsContext";
import {
  isDetailTopBarKeyAvailable,
  type DetailTopBarKey,
} from "../context/interfaceLayout";
import { useActivity } from "../context/ActivityContext";
import { EditGameModal } from "../components/game/EditGameModal";
import { EDIT_GAME_TABS, type EditGameTab } from "../components/game/editGameTabs";
import PageWidget, { PageWidgetSlot } from "../components/PageWidget";
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
  GameMediaSpotlight,
  GameQuickStatsBar,
  GameActivityPulseCard,
  ImageLightbox,
  InfoKpiCard,
  RatingsKpiCard,
  SpecsCard,
  TimeToBeatCard,
  ReleasesCard,
  LanguagesSection,
  AboutSection,
  StorylineSection,
  SystemRequirementsCard,
  DetailSectionsHiddenNote,
  WineLogsModal,
  SteamFeaturesCard,
} from "../components/game";
import { GameActivityTab } from "../components/game/GameActivityTab";
import GameNewsTab from "../components/game/GameNewsTab";
import NotesTab from "../components/game/notes/NotesTab";
import { useGameNotes } from "../hooks/useGameNotes";
import "../styles/activity.css";
import "../styles/achievements.css";
import "../styles/reviews.css";
import "../styles/game-news.css";
import "./news/NewsPage.css";
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
  IconFileText,
} from "../components/game/icons";

type GamePageTab =
  | "overview"
  | "reviews"
  | "activity"
  | "notes"
  | "achievements"
  | "mods"
  | "weblinks"
  | "news";

const VALID_TABS = new Set<GamePageTab>([
  "overview",
  "reviews",
  "activity",
  "notes",
  "achievements",
  "mods",
  "weblinks",
  "news",
]);

/**
 * Detail-top-bar keys that open an edit-modal section. The bar's keys are
 * namespaced (`editDetails`) while the modal's tabs are bare (`details`), so
 * this is the one place that maps the two.
 */
const EDIT_TAB_FOR_TOP_BAR: Partial<Record<DetailTopBarKey, EditGameTab>> = {
  editDetails: "details",
  editMedia: "media",
  editLaunch: "launch",
  editCompatibility: "compatibility",
};

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
  const { launchGame, enrichGameMetadata, fetchGameHltb, removeGame, updateGame } = useGames();
  const { unit: sizeUnit } = useSizeUnit();
  const { appId: heroSteamAppId } = useSteamAppId(game);
  const { isSimpleUi, detailSectionVisible, showDeckVerified, showFullLinuxUi } = useSettings();
  const { order: topBarOrder, hidden: topBarHidden } = useDetailTopBarLayout("game");
  const { getGameAchievements } = useAchievements();
  const {
    notes: gameNotes,
    loading: notesLoading,
    createNote,
    updateNote,
    deleteNote,
  } = useGameNotes(game.id, game.notes, () =>
    updateGame(game.id, { notes: undefined }),
  );

  // Achievement total from the active source (Steam / GOG / Epic / Retro /
  // manual), falling back to the legacy Steam-synced array for games that
  // predate the multi-source cache.
  const achievementTotal =
    getGameAchievements(game.id)?.total ?? game.steamAchievements?.length ?? null;

  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  // Which edit-modal section to open, or null while the modal is closed.
  const [editTab, setEditTab] = useState<EditGameTab | null>(null);
  const editing = editTab !== null;
  const [wineLogsOpen, setWineLogsOpen] = useState(false);
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
    // Rows that still carry legacy IGDB time-to-beat data (or none at
    // all) get upgraded to HowLongToBeat stats.
    const needsHltb = !game.timeToBeat?.hltb;
    const alreadyEnriched =
      !!game.metadataSource &&
      !(game.metadataSource === NO_IGDB_MATCH_SOURCE && game.igdbId != null);
    if (alreadyEnriched) {
      if (!needsHltb) return;
      enrichmentStartedRef.current = true;
      fetchGameHltb(game.id, game.name).catch((err) =>
        console.error("HLTB refresh failed:", err)
      );
      return;
    }

    const hasDescription = !!game.description;
    const hasCollection = !!game.collection;
    const hasDeveloper = !!game.developer;
    const hasPublisher = !!game.publisher;
    const hasGenres = !!(game.genres && game.genres.length > 0);
    const hasAllRelationFields = hasCollection && hasDeveloper && hasPublisher && hasGenres;
    const missedCollectionId = !!game.collection && game.collectionId === undefined;

    if (hasDescription && !needsHltb && hasAllRelationFields && !missedCollectionId) {
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
    fetchGameHltb,
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

  const gameTabOrder = useDetailTabOrder("game");

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
        id: "notes" as const,
        label: t("notes.title"),
        icon: IconFileText,
        count: gameNotes.length > 0 ? gameNotes.length : null,
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
    return allTabs
      .sort((a, b) => gameTabOrder.indexOf(a.id) - gameTabOrder.indexOf(b.id))
      .filter((tab) => isTabVisible(tab.id));
  }, [t, achievementTotal, game.websites, gameNotes.length, isTabVisible, gameTabOrder]);

  // The top bar renders straight from the persisted order/visibility. Items the
  // platform can't offer (Wine Logs / Compatibility on non-Linux hosts) are
  // skipped even when visible, matching the old hardcoded gate. Contiguous
  // edit-modal shortcuts are chunked into one `.game-edit-tab-shortcuts` group
  // so the divider between the back link and the action cluster survives.
  const renderTopBar = () => {
    const nodes: ReactNode[] = [];
    let group: ReactNode[] = [];
    let groupKey = "";
    const flushGroup = () => {
      if (group.length === 0) return;
      nodes.push(
        <div
          key={`edit-group:${groupKey}`}
          className="game-edit-tab-shortcuts"
          role="group"
          aria-label={t("library.context.editGame")}
        >
          {group}
        </div>,
      );
      group = [];
      groupKey = "";
    };

    for (const key of topBarOrder) {
      if (topBarHidden[key]) continue;
      // Shared capability gate: the Layout Studio hides the same keys via this
      // helper, so a host that cannot offer them never renders them here.
      if (!isDetailTopBarKeyAvailable(key, { showFullLinuxUi })) continue;

      if (key === "wineLogs") {
        flushGroup();
        nodes.push(
          <button
            key="wineLogs"
            type="button"
            className="game-edit-btn"
            onClick={() => setWineLogsOpen(true)}
            title={t("wineLogs.tooltip") || "Wine / Proton Logs"}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span>{t("wineLogs.button") || "Wine Logs"}</span>
          </button>,
        );
        continue;
      }

      const editTab = EDIT_TAB_FOR_TOP_BAR[key];
      if (editTab) {
        const def = EDIT_GAME_TABS.find((entry) => entry.key === editTab);
        if (!def) continue;
        if (!groupKey) groupKey = key;
        group.push(
          <button
            key={key}
            type="button"
            className="game-edit-btn"
            onClick={() => setEditTab(editTab)}
            title={t(def.labelKey)}
          >
            {def.icon}
            <span>{t(def.labelKey)}</span>
          </button>,
        );
        continue;
      }

      flushGroup();
      if (key === "back") {
        nodes.push(
          <button
            key="back"
            className="game-back-link game-top-bar__back"
            onClick={handleBack}
            aria-label={t("gamePage.returnToLibrary")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>{t("page.game.returnToLibrary")}</span>
          </button>,
        );
      } else if (key === "quickActions") {
        nodes.push(
          <GameQuickActions
            key="quickActions"
            game={game}
            gameName={game.name}
            steamAppId={game.steamAppId}
            executablePath={game.path}
            onEditTab={setEditTab}
            onRemove={() => setShowRemoveConfirm(true)}
            onOpenWineLogs={showFullLinuxUi ? () => setWineLogsOpen(true) : undefined}
          />,
        );
      }
    }

    flushGroup();
    return nodes;
  };

  return (
    <div className="game-page">
      {/* Top Bar with Return Link and Edit / Remove actions */}
      <div className="game-top-bar">{renderTopBar()}</div>

      {/* Hero Banner */}
      <PageWidget page="game" widget="gameHero">
        <div className="ui-item-gameHero">
          <GameHero
            game={game}
            steamAppId={heroSteamAppId}
            onLaunch={handleLaunch}
          />
        </div>
      </PageWidget>

      {/* Sticky Segmented Tabs with Sliding Indicator */}
      <PageWidget page="game" widget="gameTabs">
        <div className="ui-item-gameTabs">
          <GameTabs
            tabs={tabs}
            activeTab={effectiveTab}
            onChange={handleTabChange}
          />
        </div>
      </PageWidget>

      {/* Tab Content Panels */}
      {effectiveTab === "overview" && (
        <>
          {/* Overview Quick Stats Command Bar */}
          <PageWidget page="game" widget="gameQuickStats">
            <div className="ui-item-gameQuickStats">
              <GameQuickStatsBar
                game={game}
                steamAppId={heroSteamAppId}
                sizeUnit={sizeUnit}
              />
            </div>
          </PageWidget>

          <div className="game-content-grid">
            <div className="game-main-col">
              <DetailSectionsHiddenNote
                sections={[
                  "steamFeatures",
                  "systemRequirements",
                  "gameRelations",
                  "timeToBeat",
                  "protonDb",
                  "releases",
                  "reviews",
                  "activity",
                  "notes",
                  "achievements",
                  "mods",
                  "weblinks",
                  "news",
                ]}
              />

              {/* 1. About & Story Synopsis */}
              <PageWidget page="game" widget="gameAbout">
                <div className="ui-item-gameAbout">
                  <AboutSection game={game} />
                </div>
              </PageWidget>
              
              <PageWidget page="game" widget="gameStoryline">
                <div className="ui-complete-only ui-item-gameStoryline">
                  <StorylineSection game={game} />
                </div>
              </PageWidget>

              {/* 2. Interactive Media Showcase */}
              <PageWidget page="game" widget="gameMedia">
                <div className="ui-item-gameMedia">
                  <GameMediaSpotlight
                    game={game}
                    onOpenLightbox={handleOpenScreenshot}
                    steamAppId={heroSteamAppId}
                  />
                </div>
              </PageWidget>

              {/* 3. Hardware & System Requirements */}
              {detailSectionVisible.systemRequirements && (
                <PageWidget page="game" widget="gameSysReq">
                  <div className="ui-item-gameSysReq">
                    <SystemRequirementsCard steamAppId={game.steamAppId ?? null} />
                  </div>
                </PageWidget>
              )}

              {/* 4. Franchise & Similar Games */}
              <PageWidget page="game" widget="gameRelations">
                <div className="ui-complete-only ui-item-gameRelations">
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
              </PageWidget>
            </div>

            <div className="game-side-col">
              {/* Personal Play Pulse */}
              {detailSectionVisible.activity && (
                <PageWidget page="game" widget="gamePulse">
                  <div className="ui-item-gamePulse">
                    <GameActivityPulseCard
                      game={game}
                      onNavigateTab={(tab) => handleTabChange(tab)}
                    />
                  </div>
                </PageWidget>
              )}

              <PageWidgetSlot page="game" widget="gameInfoKpi" className="ui-item-gameInfoKpi">
                <InfoKpiCard
                  game={game}
                  sizeUnit={sizeUnit}
                  onEditSize={() => setEditTab("details")}
                />
              </PageWidgetSlot>
              {detailSectionVisible.steamFeatures && (
                <PageWidgetSlot
                  page="game"
                  widget="gameSteamFeatures"
                  className="ui-item-gameSteamFeatures"
                >
                  <SteamFeaturesCard
                    steamAppId={game.steamAppId ?? heroSteamAppId}
                    gameName={game.name}
                  />
                </PageWidgetSlot>
              )}
              <PageWidgetSlot page="game" widget="gameRatings" className="ui-item-gameRatings">
                <RatingsKpiCard game={game} />
              </PageWidgetSlot>
              {detailSectionVisible.timeToBeat && (
                <PageWidgetSlot
                  page="game"
                  widget="gameTimeToBeat"
                  className="ui-item-gameTimeToBeat"
                >
                  <TimeToBeatCard game={game} />
                </PageWidgetSlot>
              )}
              <PageWidgetSlot
                page="game"
                widget="gameSpecsCard"
                className="ui-complete-only ui-item-gameSpecsCard"
              >
                <SpecsCard game={game} />
              </PageWidgetSlot>
              {showDeckVerified && detailSectionVisible.protonDb && (
                <PageWidgetSlot
                  page="game"
                  widget="gameProtonDb"
                  className="ui-complete-only ui-item-gameProtonDb"
                >
                  <ProtonDBCard steamAppId={game.steamAppId} />
                </PageWidgetSlot>
              )}
              <PageWidgetSlot
                page="game"
                widget="gameCrackwatch"
                className="ui-complete-only ui-item-gameCrackwatch"
              >
                <CrackWatchCard gameName={game.name} appId={game.steamAppId} />
              </PageWidgetSlot>
              {detailSectionVisible.releases && (
                <PageWidgetSlot
                  page="game"
                  widget="gameReleases"
                  className="ui-complete-only ui-item-gameReleases"
                >
                  <ReleasesCard game={game} />
                </PageWidgetSlot>
              )}
              <PageWidgetSlot
                page="game"
                widget="gameLanguages"
                className="ui-complete-only ui-item-gameLanguages"
              >
                <LanguagesSection game={game} />
              </PageWidgetSlot>
            </div>
          </div>
        </>
      )}

      {effectiveTab === "reviews" && <ReviewsTab game={game} />}

      {effectiveTab === "activity" && <GameActivityTab game={game} />}

      {effectiveTab === "notes" && (
        <NotesTab
          game={game}
          notes={gameNotes}
          loading={notesLoading}
          onCreate={createNote}
          onUpdate={updateNote}
          onDelete={deleteNote}
        />
      )}

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
      {editTab && (
        <EditGameModal
          key={editTab}
          game={game}
          initialTab={editTab}
          onClose={() => setEditTab(null)}
        />
      )}

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

      {showFullLinuxUi && wineLogsOpen && (
        <WineLogsModal
          gameId={game.id}
          gameName={game.name}
          onClose={() => setWineLogsOpen(false)}
          onOpenEditTab={(tab) => {
            setWineLogsOpen(false);
            setEditTab(tab);
          }}
        />
      )}
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
