import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import type { GameMetadataResult, IgdbReview, Game, StoreGameSummary } from "../types/game";
import { useWishlistContext } from "../context/WishlistContext";
import { useSettings, type DetailSectionKey } from "../context/SettingsContext";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { setActiveGameArtwork } from "../utils/activeGameArtwork";
import { Button } from "../components/ui";
import WebLinksTab from "../components/WebLinksTab";
import ReviewsTab from "../components/ReviewsTab";
import AchievementsTab from "../components/AchievementsTab";
import DownloadButton from "../components/DownloadButton";
import CrackWatchCard from "../components/CrackWatchCard";
import GameNewsTab from "../components/game/GameNewsTab";
import ProtonDBCard from "../components/ProtonDBCard";
import GameRelationsCard from "../components/GameRelationsCard";
import StoreGameLoadingSkeleton from "../components/store/StoreGameLoadingSkeleton";
import {
  IconOverview,
  IconMessageSquare,
  IconTrophy,
  IconGlobe,
  IconNewspaper,
} from "../components/game/icons";
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
  DetailSectionsHiddenNote,
} from "../components/game";
import "../styles/page-store.css";
import "../styles/achievements.css";
import "../styles/reviews.css";
import "../styles/game-news.css";
import "../styles/weblinks.css";

/* ------------------------------------------------------------------ */
/*  Error and Not Found States                                         */
/* ------------------------------------------------------------------ */

function StoreGameError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  return (
    <div className="main-empty">
      <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h2 className="main-empty-title">{t("store.failedToLoad")}</h2>
      <p className="main-empty-subtitle">{message}</p>
      <div style={{ display: "flex", gap: "var(--space-md)", marginTop: "var(--space-md)" }}>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate("/store")}>
          {t("store.backToStore")}
        </Button>
      </div>
    </div>
  );
}

function StoreGameNotFound() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  return (
    <div className="main-empty">
      <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <h2 className="main-empty-title">{t("game.notFoundTitle")}</h2>
      <p className="main-empty-subtitle">{t("store.gameNotFoundIgdb")}</p>
      <Button variant="ghost" size="sm" onClick={() => navigate("/store")}>
        {t("store.backToStore")}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Store Game Detail Component                                  */
/* ------------------------------------------------------------------ */

type StoreTab = "overview" | "reviews" | "achievements" | "weblinks" | "news";

const VALID_STORE_TABS = new Set<StoreTab>([
  "overview",
  "reviews",
  "achievements",
  "weblinks",
  "news",
]);

export default function StoreGameDetail() {
  const { gameSlug } = useParams<{ gameSlug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { games, addStoreGame } = useGames();
  const { isWishlisted, toggle: toggleWishlist } = useWishlistContext();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { unit: sizeUnit } = useSizeUnit();
  const { isSimpleUi, detailSectionVisible } = useSettings();

  const [data, setData] = useState<GameMetadataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const mountedRef = useRef(true);
  const enrichedSlugRef = useRef<string | null>(null);

  // Tab synchronization with URL query param
  const urlTab = searchParams.get("tab") as StoreTab | null;
  const activeTab: StoreTab = urlTab && VALID_STORE_TABS.has(urlTab) ? urlTab : "overview";

  // A tab is reachable unless it's a simple-UI exclusion or the user
  // disabled that detail section in Settings → Appearance.
  const isTabVisible = useCallback(
    (tab: StoreTab): boolean => {
      if (tab === "overview") return true;
      if (isSimpleUi && (tab === "weblinks" || tab === "news")) return false;
      return detailSectionVisible[tab as DetailSectionKey];
    },
    [isSimpleUi, detailSectionVisible],
  );

  const handleTabChange = useCallback(
    (newTab: StoreTab) => {
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

  // Extract Steam app id from websites
  const steamAppId = useMemo(() => {
    if (!data?.websites) return undefined;
    for (const url of data.websites) {
      const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }
    return undefined;
  }, [data]);

  // Construct mock Game representation for shared components
  const mockGame = useMemo((): Game | null => {
    if (!data) return null;
    return {
      id: `store-${data.title}`,
      name: data.title,
      path: "",
      platform: data.sourceName === "Steam" ? "Steam" : "IGDB",
      installed: false,
      playTime: "0h",
      addedAt: Date.now(),

      // Images
      coverArtUrl: data.images.cover ?? undefined,
      bannerUrl: data.images.hero ?? data.images.banner ?? data.images.cover ?? undefined,
      logoUrl: data.images.logo ?? undefined,
      iconUrl: data.images.icon ?? undefined,

      // Metadata
      description: data.description ?? undefined,
      developer: data.developer ?? undefined,
      publisher: data.publisher ?? undefined,
      releaseDate: data.releaseDate ?? undefined,
      genres: data.genres.length > 0 ? data.genres : undefined,
      storyline: data.storyline ?? undefined,
      igdbRating: data.igdbRating ?? undefined,
      criticRating: data.criticRating ?? undefined,
      themes: data.themes?.length ? data.themes : undefined,
      gameModes: data.gameModes?.length ? data.gameModes : undefined,
      playerPerspectives: data.playerPerspectives?.length ? data.playerPerspectives : undefined,
      screenshots: data.screenshots?.length ? data.screenshots : undefined,
      videos: data.videos?.length ? data.videos : undefined,
      websites: data.websites?.length ? data.websites : undefined,
      timeToBeat: data.timeToBeat ?? undefined,
      similarGames: data.similarGames?.length ? data.similarGames : undefined,
      releases: data.releases?.length ? data.releases : undefined,
      igdbReviews: data.igdbReviews ?? undefined,
      alternativeNames: data.alternativeNames?.length ? data.alternativeNames : undefined,
      collection: data.collection ?? undefined,
      collectionId: data.collectionId,
      franchise: data.franchise ?? undefined,
      gameCategory: data.gameCategory ?? undefined,
      releaseStatus: data.releaseStatus ?? undefined,
      languageSupports: data.languageSupports?.length ? data.languageSupports : undefined,

      // Source
      metadataSource: data.sourceName,
      metadataUrl: data.sourceUrl,
      steamAppId,

      // Library defaults
      playStatus: "backlog",
    };
  }, [data, steamAppId]);

  // Fetch store game detail from backend
  const fetchData = useCallback(() => {
    if (!gameSlug) return;
    setLoading(true);
    setError(null);

    invoke<GameMetadataResult | null>("get_store_game_detail", { slug: gameSlug })
      .then((result) => {
        if (!mountedRef.current) return;
        if (result) setData(result);
        else setData(null);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(String(err));
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [gameSlug]);

  useEffect(() => {
    setData(null);
    fetchData();
  }, [fetchData]);

  // Publish store game artwork for Adaptive Theme and Auto Game Accent
  useEffect(() => {
    const art =
      data?.images.cover ?? data?.images.hero ?? data?.images.banner ?? null;
    if (art) {
      setActiveGameArtwork(art);
    }
  }, [data]);

  // Enrich title via IGDB if needed
  useEffect(() => {
    if (!data || !gameSlug) return;
    if (enrichedSlugRef.current === gameSlug) return;
    const title = data.title;
    if (!title) return;
    enrichedSlugRef.current = gameSlug;
    let cancelled = false;
    invoke<GameMetadataResult[]>("search_game_metadata", {
      gameName: title,
      skipLaunchbox: !!steamAppId,
      steamAppId,
    })
      .then((results) => {
        if (cancelled || !results || results.length === 0) return;
        const meta = results.find((r) => r.sourceName === "IGDB") ?? results[0];
        if (meta?.title && meta.title.trim()) {
          setData((prev) => (prev ? { ...prev, title: meta.title } : prev));
        }
      })
      .catch(() => {
        /* fallback to existing title */
      });
    return () => {
      cancelled = true;
    };
  }, [data, gameSlug, steamAppId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Check if game is already in library
  const existingInLibrary = useMemo(() => {
    if (!data) return null;
    const norm = data.title.toLowerCase().trim();
    return games.find((g) => g.name.toLowerCase().trim() === norm) ?? null;
  }, [data, games]);

  // Effective game for tabs
  const effectiveGame = useMemo(() => {
    if (!mockGame) return null;
    if (!existingInLibrary) return mockGame;
    return {
      ...existingInLibrary,
      steamAppId: existingInLibrary.steamAppId || steamAppId,
      coverArtUrl: existingInLibrary.coverArtUrl || mockGame.coverArtUrl,
      bannerUrl: existingInLibrary.bannerUrl || mockGame.bannerUrl,
    };
  }, [existingInLibrary, mockGame, steamAppId]);

  // Wishlist membership & summary
  const wishlisted = gameSlug ? isWishlisted(gameSlug) : false;
  const wishlistSummary = useMemo<StoreGameSummary | null>(() => {
    if (!data) return null;
    return {
      id: 0,
      name: data.title,
      slug: gameSlug ?? data.title,
      summary: data.description ?? null,
      rating: data.igdbRating ?? null,
      aggregatedRating: data.criticRating ?? null,
      coverUrl: data.images.cover ?? null,
      logoUrl: data.images.logo ?? null,
      genres: data.genres ?? [],
      platforms: [],
      firstReleaseDate: data.releaseDate ?? null,
      totalRatingCount: 0,
      hypes: 0,
      websites: data.websites ?? [],
    };
  }, [data, gameSlug]);

  const handleToggleWishlist = useCallback(() => {
    if (!wishlistSummary) return;
    const wasWishlisted = wishlisted;
    toggleWishlist(wishlistSummary);
    showToast(
      wasWishlisted
        ? t("store.removedFromWishlist", { name: data!.title })
        : t("store.addedToWishlist", { name: data!.title }),
      wasWishlisted ? "info" : "success"
    );
  }, [wishlistSummary, wishlisted, toggleWishlist, showToast, t, data]);

  const handleReviewsFetched = useCallback((reviews: IgdbReview[]) => {
    setData((prev) => (prev ? { ...prev, igdbReviews: reviews } : prev));
  }, []);

  const handleAddToLibrary = async () => {
    if (!data || adding) return;
    setAdding(true);
    try {
      await addStoreGame(data);
    } catch (err) {
      showToast(t("storeDetail.addFailed", { error: err }), "error");
    } finally {
      setAdding(false);
    }
  };

  const handleOpenScreenshot = useCallback((_src: string, index?: number) => {
    setLightboxIndex(index ?? 0);
    setLightboxOpen(true);
  }, []);

  const tabs = useMemo(() => {
    const allTabs = [
      { id: "overview" as const, label: t("game.tab.overview"), icon: IconOverview },
      { id: "reviews" as const, label: t("game.tab.reviews"), icon: IconMessageSquare },
      { id: "achievements" as const, label: t("game.tab.achievements"), icon: IconTrophy },
      {
        id: "weblinks" as const,
        label: t("game.tab.weblinks"),
        icon: IconGlobe,
        count: data?.websites?.length ?? null,
      },
      { id: "news" as const, label: t("game.tab.news"), icon: IconNewspaper },
    ];
    return allTabs.filter((tab) => isTabVisible(tab.id));
  }, [t, data?.websites, isTabVisible]);

  if (loading) return <StoreGameLoadingSkeleton />;
  if (error) return <StoreGameError message={error} onRetry={fetchData} />;
  if (!data || !mockGame) return <StoreGameNotFound />;

  const isInLibrary = !!existingInLibrary;
  const libraryGameId = existingInLibrary?.id;
  const releaseYear = data.releaseDate ? new Date(data.releaseDate).getFullYear() : null;

  const wishlistBtn = (
    <button
      type="button"
      className={`store-wishlist-btn${wishlisted ? " active" : ""}`}
      onClick={handleToggleWishlist}
      aria-pressed={wishlisted}
      aria-label={
        wishlisted
          ? t("store.gameCard.removeWishlistAria", { name: data.title })
          : t("store.gameCard.addWishlistAria", { name: data.title })
      }
    >
      <svg
        viewBox="0 0 24 24"
        fill={wishlisted ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: 18, height: 18 }}
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {wishlisted ? t("store.inWishlist") : t("store.addToWishlist")}
    </button>
  );

  const effectiveTab: StoreTab =
    activeTab !== "overview" && !isTabVisible(activeTab) ? "overview" : activeTab;

  return (
    <div className="game-page store-detail-page">
      {/* Top Breadcrumb Bar */}
      <div className="game-top-bar">
        <button className="game-back-link" onClick={() => navigate("/store")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="brand-text">{t("nav.store")}</span>
        </button>

        <div className="game-top-bar__actions">
          <GameQuickActions
            gameName={data.title}
            steamAppId={steamAppId ?? null}
            isStoreMode={true}
          />
        </div>
      </div>

      {/* Cinematic Hero */}
      <GameHero
        name={data.title}
        bannerUrl={data.images.hero ?? data.images.banner ?? null}
        coverUrl={data.images.cover ?? null}
        logoUrl={
          data.images.logo ||
          (steamAppId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/logo.png` : null)
        }
        accentSrc={data.images.cover ?? data.images.hero ?? data.images.banner ?? null}
        steamAppId={steamAppId ?? null}
        rating={data.igdbRating || data.criticRating || null}
        metaItems={[data.developer, data.publisher, releaseYear, data.sourceName].filter(
          (v): v is string => Boolean(v)
        )}
        actions={
          isInLibrary ? (
            <>
              {wishlistBtn}
              <button
                className="game-launch-btn"
                onClick={() => navigate(`/library/${libraryGameId}`)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                {t("store.viewInLibrary")}
              </button>
            </>
          ) : (
            <>
              {wishlistBtn}
              <button className="store-add-btn" onClick={handleAddToLibrary} disabled={adding}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {adding ? t("store.adding") : t("store.addToLibrary")}
              </button>
              <DownloadButton
                gameName={data.title}
                gamePoster={data.images?.cover ?? data.images?.hero ?? data.images?.banner ?? undefined}
                steamAppId={steamAppId ?? undefined}
                variant="prominent"
                label={t("game.findDownload")}
              />
            </>
          )
        }
      />

      {/* Animated Sliding Tabs */}
      <GameTabs
        tabs={tabs}
        activeTab={effectiveTab}
        onChange={handleTabChange}
      />

      {/* Tab Panels */}
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
                "achievements",
                "weblinks",
                "news",
              ]}
            />
            <AboutSection game={mockGame} />
            {detailSectionVisible.systemRequirements && (
              <SystemRequirementsCard steamAppId={steamAppId ?? null} />
            )}
            <div className="ui-complete-only">
              <StorylineSection game={mockGame} />
            </div>
            <ScreenshotsSection
              game={mockGame}
              onOpen={handleOpenScreenshot}
            />
            <VideosSection game={mockGame} />

            <div className="ui-complete-only">
              {detailSectionVisible.gameRelations && (
                <GameRelationsCard
                  mode="store"
                  currentGame={data}
                  similarGames={data.similarGames}
                  collectionId={data.collectionId}
                  collectionName={data.collection}
                />
              )}
            </div>
          </div>

          <div className="game-side-col">
            <div className="side-group">
              <InfoKpiCard game={mockGame} sizeUnit={sizeUnit} hideStatus />
              <RatingsKpiCard game={mockGame} />
              {detailSectionVisible.timeToBeat && <TimeToBeatCard game={mockGame} />}
            </div>
            <div className="side-group ui-complete-only">
              <SpecsCard game={mockGame} />
              {detailSectionVisible.protonDb && (
                <ProtonDBCard steamAppId={steamAppId} />
              )}
              <CrackWatchCard gameName={data.title} appId={steamAppId} />
            </div>
            <div className="side-group ui-complete-only">
              {detailSectionVisible.releases && <ReleasesCard game={mockGame} />}
              <LanguagesSection game={mockGame} />
            </div>
          </div>
        </div>
      )}

      {effectiveTab === "reviews" && (
        <ReviewsTab game={mockGame} onReviewsFetched={handleReviewsFetched} />
      )}

      {effectiveTab === "achievements" && effectiveGame && (
        <AchievementsTab game={effectiveGame} />
      )}

      {effectiveTab === "weblinks" && (
        <WebLinksTab game={mockGame} visible={!lightboxOpen} />
      )}

      {effectiveTab === "news" && (
        <GameNewsTab game={mockGame} />
      )}

      {/* Unified Image Lightbox */}
      <ImageLightbox
        images={mockGame.screenshots || []}
        currentIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onSelectIndex={setLightboxIndex}
        title={data.title}
      />
    </div>
  );
}
