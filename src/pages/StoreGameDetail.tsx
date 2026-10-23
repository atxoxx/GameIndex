import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import type { GameMetadataResult, IgdbReview, Game, StoreGameSummary } from "../types/game";
import { useWishlistContext } from "../context/WishlistContext";
import { usePresence } from "../context/PresenceContext";
import { useSettings, useLayoutSettings, useDetailTabOrder, useDetailTopBarLayout, useWidgetVisible, type DetailSectionKey } from "../context/SettingsContext";
import { isDetailTopBarKeyAvailable } from "../context/interfaceLayout";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { setActiveGameArtwork } from "../utils/activeGameArtwork";
import PageWidget from "../components/PageWidget";
import { Button } from "../components/ui";
import WebLinksTab from "../components/WebLinksTab";
import ReviewsTab from "../components/ReviewsTab";
import AchievementsTab from "../components/AchievementsTab";
import DownloadButton from "../components/DownloadButton";
import CrackWatchCard from "../components/CrackWatchCard";
import GameNewsTab from "../components/game/GameNewsTab";
import MapTab from "../components/game/MapTab";
import { readPersistedLookupFound } from "../components/game/mapLookupStorage";
import ProtonDBCard from "../components/ProtonDBCard";
import GameRelationsCard from "../components/GameRelationsCard";
import StoreGameLoadingSkeleton from "../components/store/StoreGameLoadingSkeleton";
import StoreActionBar from "../components/store/StoreActionBar";
import { useGameMaps } from "../hooks/useGameMaps";
import {
  IconOverview,
  IconMessageSquare,
  IconTrophy,
  IconGlobe,
  IconNewspaper,
  IconDlc,
  IconMap,
  IconExternalLink,
} from "../components/game/icons";
import {
  GameHero,
  GameTabs,
  GameQuickActions,
  GameMediaSpotlight,
  GameQuickStatsBar,
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
  SteamFeaturesCard,
  GameDlcCard,
  GameDlcTab,
  DetailRail,
  STORE_RAIL_GROUPS,
} from "../components/game";
import "../styles/page-store.css";
import "../styles/achievements.css";
import "../styles/reviews.css";
import "../styles/game-news.css";
import "../styles/mapgenie.css";
import "../styles/weblinks.css";
import "../styles/game-tab-immersive.css";

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
      <div className="main-empty__actions">
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

type StoreTab = "overview" | "reviews" | "achievements" | "weblinks" | "news" | "dlc" | "map";

const VALID_STORE_TABS = new Set<StoreTab>([
  "overview",
  "reviews",
  "achievements",
  "weblinks",
  "news",
  "dlc",
  "map",
]);

export default function StoreGameDetail({ hideBackLink = false }: { hideBackLink?: boolean }) {
  const { gameSlug } = useParams<{ gameSlug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { games, addStoreGame } = useGames();
  const { setStoreGameName, setStoreGameArt } = usePresence();
  const { isWishlisted, toggle: toggleWishlist } = useWishlistContext();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { unit: sizeUnit } = useSizeUnit();
  const { isSimpleUi, showDeckVerified, showFullLinuxUi } = useSettings();
  const { detailSectionVisible } = useLayoutSettings();
  // Top-bar order/visibility, resolved before the loading/error early returns
  // so the hook order stays stable.
  const { order: topBarOrder, hidden: topBarHidden } = useDetailTopBarLayout("store");
  // With the hero switched off in the Layout Studio there is nothing to
  // scroll past, so the docked bar has to carry the actions on its own.
  const heroVisible = useWidgetVisible("storeGame", "gameHero");

  const [data, setData] = useState<GameMetadataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // The docked action bar duplicates the hero's action cluster, so it only
  // appears once that cluster has scrolled out of view.
  const [heroInView, setHeroInView] = useState(true);
  const heroObserverRef = useRef<IntersectionObserver | null>(null);
  const heroRef = useCallback((node: HTMLDivElement | null) => {
    heroObserverRef.current?.disconnect();
    heroObserverRef.current = null;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setHeroInView(entry.isIntersecting)
    );
    observer.observe(node);
    heroObserverRef.current = observer;
  }, []);

  useEffect(() => () => heroObserverRef.current?.disconnect(), []);

  const mountedRef = useRef(true);
  const enrichedSlugRef = useRef<string | null>(null);

  // Map provider lookup — resolved before the loading/error early returns so
  // hook order stays stable. Title is empty until the detail fetch lands,
  // which simply keeps the Map tab hidden until then.
  const mapLookup = useGameMaps(data?.title);
  const [mapHasResult, setMapHasResult] = useState<boolean | null>(() =>
    readPersistedLookupFound(gameSlug)
  );
  const mapAvailable = mapHasResult ?? mapLookup.sources.length > 0;
  const mapStatusKnown = mapLookup.status !== "loading" || mapHasResult !== null;

  useEffect(() => {
    setMapHasResult(readPersistedLookupFound(gameSlug));
  }, [gameSlug, data?.title]);

  // Extract Steam app id from websites
  const steamAppId = useMemo(() => {
    if (!data?.websites) return undefined;
    for (const url of data.websites) {
      const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }
    return undefined;
  }, [data]);

  // Tab synchronization with URL query param
  const urlTab = searchParams.get("tab") as StoreTab | null;
  const activeTab: StoreTab = urlTab && VALID_STORE_TABS.has(urlTab) ? urlTab : "overview";

  // A tab is reachable unless it's a simple-UI exclusion or the user
  // disabled that detail section in Settings → Appearance.
  const isTabVisible = useCallback(
    (tab: StoreTab): boolean => {
      if (tab === "overview") return true;
      // DLC & Add-ons are fetched from Steam's store API, so the tab only
      // exists once we have a Steam app id for this title.
      if (tab === "dlc") return !!steamAppId && detailSectionVisible.dlc;
      if (isSimpleUi && (tab === "weblinks" || tab === "news")) return false;
      return detailSectionVisible[tab as DetailSectionKey];
    },
    [isSimpleUi, detailSectionVisible, steamAppId],
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

  // Publish the resolved title so Discord presence shows the real name instead
  // of the lowercased URL slug while this page is open.
  useEffect(() => {
    setStoreGameName(data?.title ?? null);
    return () => setStoreGameName(null);
  }, [data?.title, setStoreGameName]);

  // Publish the store art so Discord presence shows the cover/logo while this
  // page is open. Only public https sources are usable — Discord fetches the
  // image server-side — so `discordAsset` filters the rest downstream.
  useEffect(() => {
    setStoreGameArt(
      data?.images.cover ??
        data?.images.logo ??
        data?.images.hero ??
        data?.images.banner ??
        null,
    );
    return () => setStoreGameArt(null);
  }, [data?.images, setStoreGameArt]);

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

  const storeTabOrder = useDetailTabOrder("store");

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
      { id: "dlc" as const, label: t("game.tab.dlc"), icon: IconDlc },
      // A normal detail tab (hidden/reordered in the Layout Studio). When no
      // provider matches it still opens so the user can search by name.
      {
        id: "map" as const,
        label: t("game.tab.map"),
        icon: IconMap,
        badge: mapStatusKnown ? (
          <span
            className={`game-tab-status game-tab-status--${
              mapAvailable ? "found" : "missing"
            }`}
            title={mapAvailable ? t("map.statusFound") : t("map.statusMissing")}
            aria-hidden="true"
          />
        ) : undefined,
      },
    ];
    const order = (id: StoreTab) => {
      const idx = (storeTabOrder as readonly string[]).indexOf(id);
      return idx === -1 ? storeTabOrder.length : idx;
    };
    return allTabs
      .sort((a, b) => order(a.id) - order(b.id))
      .filter((tab) => isTabVisible(tab.id));
  }, [t, data?.websites, isTabVisible, storeTabOrder, mapAvailable, mapStatusKnown]);

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
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {wishlisted ? t("store.inWishlist") : t("store.addToWishlist")}
    </button>
  );

  const effectiveTab: StoreTab =
    activeTab !== "overview" && !isTabVisible(activeTab) ? "overview" : activeTab;

  return (
    <div className="game-page game-page--immersive">
      {/* Top Breadcrumb Bar — floats over the hero art, same contract as the
          Library detail page (persisted order, shared scrim ink). */}
      <div className="game-top-bar">
        {topBarOrder.map((key) => {
          if (topBarHidden[key]) return null;
          // Shared capability gate — the Layout Studio hides the same keys
          // through this helper, so the two detail pages never disagree.
          if (!isDetailTopBarKeyAvailable(key, { showFullLinuxUi })) return null;
          if (key === "back") {
            if (hideBackLink) return null;
            return (
              <button
                key="back"
                className="game-back-link game-top-bar__back"
                onClick={() => navigate("/store")}
                aria-label={t("store.backToStore")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>{t("nav.store")}</span>
              </button>
            );
          }
          if (key === "quickActions") {
            return (
              <GameQuickActions
                key="quickActions"
                gameName={data.title}
                steamAppId={steamAppId ?? null}
                isStoreMode={true}
              />
            );
          }
          return null;
        })}
      </div>

      {/* Cinematic Hero */}
      <PageWidget page="storeGame" widget="gameHero">
        <div className="ui-item-gameHero store-detail-hero" ref={heroRef}>
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
            genres={data.genres}
            screenshots={data.screenshots}
            onTabChange={handleTabChange}
            metaItems={[data.developer, data.publisher, releaseYear, data.sourceName].filter(
              (v): v is string => Boolean(v)
            )}
            actions={
              isInLibrary ? (
                <>
                  {wishlistBtn}
                  <button
                    type="button"
                    className="game-launch-btn"
                    onClick={() => navigate(`/library/${libraryGameId}`)}
                  >
                    <IconExternalLink size={16} />
                    {t("store.viewInLibrary")}
                  </button>
                </>
              ) : (
                <>
                  {wishlistBtn}
                  <button
                    type="button"
                    className="store-add-btn"
                    onClick={handleAddToLibrary}
                    disabled={adding}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    {adding ? t("store.adding") : t("store.addToLibrary")}
                  </button>
                  {/* The docked bar repeats this action with the neutral
                      variant, so the hero ships the same one — one primary
                      CTA per screen instead of two competing accent fills. */}
                  <DownloadButton
                    gameName={data.title}
                    gamePoster={data.images?.cover ?? data.images?.hero ?? data.images?.banner ?? undefined}
                    steamAppId={steamAppId ?? undefined}
                    label={t("game.findDownload")}
                  />
                </>
              )
            }
          />
        </div>
      </PageWidget>

      {/* Animated Sliding Tabs */}
      <PageWidget page="storeGame" widget="gameTabs">
        <div className="ui-item-gameTabs">
          <GameTabs
            tabs={tabs}
            activeTab={effectiveTab}
            onChange={handleTabChange}
          />
        </div>
      </PageWidget>

      {/* Tab Panels */}
      {effectiveTab === "overview" && (
        <>
          {/* Overview Quick Stats Command Bar */}
          <PageWidget page="storeGame" widget="gameQuickStats">
            <div className="ui-item-gameQuickStats">
              <GameQuickStatsBar
                game={mockGame}
                steamAppId={steamAppId}
                sizeUnit={sizeUnit}
                isStoreMode={true}
              />
            </div>
          </PageWidget>

          <DetailSectionsHiddenNote
            sections={[
              "dlc",
              "steamFeatures",
              "systemRequirements",
              "gameRelations",
              "timeToBeat",
              "protonDb",
              "releases",
              "reviews",
              "achievements",
              "weblinks",
              "news",
              "map",
            ]}
          />

          <div className="game-content-grid">
            <div className="game-main-col">
              {/* Media leads the reading column, same as the library page. */}
              <PageWidget page="storeGame" widget="gameMedia">
                <div className="ui-item-gameMedia">
                  <GameMediaSpotlight
                    game={mockGame}
                    onOpenLightbox={handleOpenScreenshot}
                    steamAppId={steamAppId}
                  />
                </div>
              </PageWidget>

              <PageWidget page="storeGame" widget="gameAbout">
                <div className="ui-item-gameAbout">
                  <AboutSection
                    game={mockGame}
                    steamAppId={steamAppId}
                    igdbSlug={gameSlug}
                  />
                </div>
              </PageWidget>

              <PageWidget page="storeGame" widget="gameStoryline">
                <div className="ui-complete-only ui-item-gameStoryline">
                  <StorylineSection game={mockGame} />
                </div>
              </PageWidget>

              {detailSectionVisible.systemRequirements && (
                <PageWidget page="storeGame" widget="gameSysReq">
                  <div className="ui-item-gameSysReq">
                    <SystemRequirementsCard steamAppId={steamAppId ?? null} />
                  </div>
                </PageWidget>
              )}

              <PageWidget page="storeGame" widget="gameRelations">
                <div className="ui-complete-only ui-item-gameRelations">
                  {detailSectionVisible.gameRelations && (
                    <GameRelationsCard
                      mode="store"
                      currentGame={data}
                      igdbId={data.igdbId ?? null}
                      similarGames={data.similarGames}
                      collectionId={data.collectionId}
                      collectionName={data.collection}
                    />
                  )}
                </div>
              </PageWidget>
            </div>

            <DetailRail
              page="storeGame"
              groups={STORE_RAIL_GROUPS}
              renderWidget={(widget) => {
                switch (widget) {
                  case "gameInfoKpi":
                    return <InfoKpiCard game={mockGame} sizeUnit={sizeUnit} hideStatus />;
                  case "gameRatings":
                    return <RatingsKpiCard game={mockGame} />;
                  case "gameTimeToBeat":
                    return detailSectionVisible.timeToBeat ? (
                      <TimeToBeatCard game={mockGame} />
                    ) : null;
                  case "gameDlcCard":
                    return detailSectionVisible.dlc && steamAppId ? (
                      <GameDlcCard
                        game={effectiveGame}
                        storeAppId={steamAppId}
                        gameName={data.title}
                        onViewAllDlcs={() => handleTabChange("dlc")}
                      />
                    ) : null;
                  case "gameSteamFeatures":
                    return detailSectionVisible.steamFeatures ? (
                      <SteamFeaturesCard steamAppId={steamAppId} gameName={data.title} />
                    ) : null;
                  case "gameReleases":
                    return detailSectionVisible.releases ? (
                      <ReleasesCard game={mockGame} />
                    ) : null;
                  case "gameLanguages":
                    return <LanguagesSection game={mockGame} />;
                  case "gameProtonDb":
                    return showDeckVerified && detailSectionVisible.protonDb ? (
                      <ProtonDBCard steamAppId={steamAppId} />
                    ) : null;
                  case "gameCrackwatch":
                    return <CrackWatchCard gameName={data.title} appId={steamAppId} />;
                  case "gameSpecsCard":
                    return <SpecsCard game={mockGame} />;
                  default:
                    return null;
                }
              }}
            />
          </div>
        </>
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

      {effectiveTab === "dlc" && (
        <GameDlcTab
          game={effectiveGame}
          storeAppId={steamAppId}
          gameName={data.title}
        />
      )}

      {effectiveTab === "map" && (
        <MapTab
          sources={mapLookup.sources}
          gameName={data?.title}
          searchKey={gameSlug}
          onResultChange={setMapHasResult}
          visible={!lightboxOpen}
        />
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

      {/* Docked actions, once the hero cluster is out of view */}
      <StoreActionBar
        visible={(!heroVisible || !heroInView) && !lightboxOpen}
        title={data.title}
        coverUrl={data.images.cover ?? data.images.hero ?? data.images.banner ?? null}
        steamAppId={steamAppId}
        isInLibrary={isInLibrary}
        libraryGameId={libraryGameId}
        wishlisted={wishlisted}
        onToggleWishlist={handleToggleWishlist}
        onAdd={handleAddToLibrary}
        adding={adding}
        onOpenLibrary={() => navigate(`/library/${libraryGameId}`)}
      />
    </div>
  );
}
