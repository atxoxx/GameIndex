import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useLanguage } from "../context/LanguageContext";
import BigScreenStoreGamePage from "../components/store/BigScreenStoreGamePage";
import type { GameMetadataResult, IgdbReview, Game, StoreGameSummary } from "../types/game";
import { useWishlistContext } from "../context/WishlistContext";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { Button } from "../components/ui";
import { Skeleton, SkeletonText } from "../components/ui/Skeleton";
import WebLinksTab from "../components/WebLinksTab";
import ReviewsTab from "../components/ReviewsTab";
import DownloadButton from "../components/DownloadButton";
import CrackWatchCard from "../components/CrackWatchCard";
import ProtonDBCard from "../components/ProtonDBCard";
import GameRelationsCard from "../components/GameRelationsCard";
import {
  GameHero,
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
import "../styles/page-store.css";


/* ------------------------------------------------------------------ */
/*  States                                                             */
/* ------------------------------------------------------------------ */

function StoreGameLoading() {
  const { t } = useLanguage();
  return (
    <div className="game-page">
      <Skeleton shape="rect" height="240px" width="100%" style={{ borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-xl)' }} />
      <div style={{ display: 'flex', gap: 'var(--space-xl)' }}>
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
          <Skeleton shape="rect" height="160px" width="100%" style={{ borderRadius: 'var(--radius-lg)' }} />
          <Skeleton shape="rect" height="200px" width="100%" style={{ borderRadius: 'var(--radius-lg)' }} />
          <SkeletonText lines={4} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
          <Skeleton shape="rect" height="120px" width="100%" style={{ borderRadius: 'var(--radius-lg)' }} />
          <Skeleton shape="rect" height="120px" width="100%" style={{ borderRadius: 'var(--radius-lg)' }} />
          <Skeleton shape="rect" height="120px" width="100%" style={{ borderRadius: 'var(--radius-lg)' }} />
        </div>
      </div>
      <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-muted)' }}>
        <div className="store-spinner" style={{ margin: '0 auto var(--space-md) auto' }} />
        {t("store.loadingGameDetails")}
      </div>
    </div>
  );
}

function StoreGameError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  return (
    <div className="main-empty">
      <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h2 className="main-empty-title">{t("store.failedToLoad")}</h2>
      <p className="main-empty-subtitle">{message}</p>
      <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
        <Button variant="ghost" size="sm" onClick={onRetry}>{t("common.retry")}</Button>
        <Button variant="ghost" size="sm" onClick={() => navigate("/store")}>{t("store.backToStore")}</Button>
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
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <h2 className="main-empty-title">{t("game.notFoundTitle")}</h2>
      <p className="main-empty-subtitle">{t("store.gameNotFoundIgdb")}</p>
      <Button variant="ghost" size="sm" onClick={() => navigate("/store")}>{t("store.backToStore")}</Button>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

type Tab = "overview" | "reviews" | "weblinks";

export default function StoreGameDetail() {
  const { gameSlug } = useParams<{ gameSlug: string }>();
  const navigate = useNavigate();
  const { games, addStoreGame } = useGames();
  const { showToast } = useToast();
  const { unit: sizeUnit } = useSizeUnit();
  const { isBigScreen } = useBigScreen();
  const { t } = useLanguage();
  const { isWishlisted, toggle: toggleWishlist } = useWishlistContext();

  const [data, setData] = useState<GameMetadataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Tracks which slug we've already run IGDB title-enrichment for so the
  // follow-up setData (which changes `data`) doesn't re-trigger it.
  const enrichedSlugRef = useRef<string | null>(null);

  // Extract Steam app id from websites
  const steamAppId = useMemo(() => {
    if (!data?.websites) return undefined;
    for (const url of data.websites) {
      const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }
    return undefined;
  }, [data]);

  // Build a rich Game object from the IGDB metadata so the shared
  // game components (InfoKpiCard, RatingsKpiCard, etc.) can render
  // the same cards they render on the library GamePage.
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

      // ── Images ──────────────────────────────────────────────
      coverArtUrl: data.images.cover ?? undefined,
      bannerUrl: data.images.hero ?? data.images.banner ?? data.images.cover ?? undefined,
      logoUrl: data.images.logo ?? undefined,
      iconUrl: data.images.icon ?? undefined,

      // ── Metadata ────────────────────────────────────────────
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

      // ── Source ──────────────────────────────────────────────
      metadataSource: data.sourceName,
      metadataUrl: data.sourceUrl,
      steamAppId,

      // ── Library defaults ────────────────────────────────────
      playStatus: "backlog",
    };
  }, [data, steamAppId]);

  // Abort-safe fetch
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
    setActiveTab("overview");
    fetchData();
  }, [fetchData]);

  // Enrich the displayed title via IGDB (mirrors the library GamePage
  // auto-enrich). We re-run an IGDB search against the store title and, if
  // it yields a canonical title, adopt it; otherwise we keep the normal
  // store title as a fallback. Runs once per slug.
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
    })
      .then((results) => {
        if (cancelled || !results || results.length === 0) return;
        const meta =
          results.find((r) => r.sourceName === "IGDB") ?? results[0];
        if (meta?.title && meta.title.trim()) {
          setData((prev) => (prev ? { ...prev, title: meta.title } : prev));
        }
      })
      .catch(() => {
        /* keep the normal store title on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [data, gameSlug, steamAppId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Check if already in library
  const existingInLibrary = useMemo(() => {
    if (!data) return null;
    const norm = data.title.toLowerCase().trim();
    return games.find((g) => g.name.toLowerCase().trim() === norm) ?? null;
  }, [data, games]);

  // Wishlist membership + a StoreGameSummary for the toggle.
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
      wasWishlisted ? "info" : "success",
    );
  }, [wishlistSummary, wishlisted, toggleWishlist, showToast, t, data]);

  const handleReviewsFetched = useCallback(
    (reviews: IgdbReview[], _source: string) => {
      setData((prev) => (prev ? { ...prev, igdbReviews: reviews } : prev));
    },
    []
  );

  // ── Lightbox keyboard nav ──────────────────────────────────────
  // Esc closes; ←/→ step through the game's screenshot gallery while
  // the lightbox is open. The handlers attach only while an image is
  // shown (effect dependency on lightboxImage) so they don't swallow
  // keys on the rest of the page.
  const lightboxIndex = useMemo(() => {
    if (!lightboxImage || !mockGame?.screenshots) return -1;
    return mockGame.screenshots.indexOf(lightboxImage);
  }, [lightboxImage, mockGame]);

  const stepLightbox = useCallback(
    (dir: 1 | -1) => {
      if (!mockGame?.screenshots || mockGame.screenshots.length === 0) return;
      const list = mockGame.screenshots;
      const current = lightboxIndex < 0 ? 0 : lightboxIndex;
      const next = (current + dir + list.length) % list.length;
      setLightboxImage(list[next]);
    },
    [lightboxIndex, mockGame]
  );

  useEffect(() => {
    if (!lightboxImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxImage(null);
      else if (e.key === "ArrowLeft") stepLightbox(-1);
      else if (e.key === "ArrowRight") stepLightbox(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxImage, stepLightbox]);

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

  // ── Render states ──────────────────────────────────────────────
  if (loading) return <StoreGameLoading />;
  if (error) return <StoreGameError message={error} onRetry={fetchData} />;
  if (!data || !mockGame) return <StoreGameNotFound />;

  const isInLibrary = !!existingInLibrary;
  const libraryGameId = existingInLibrary?.id;
  const releaseYear = data.releaseDate
    ? new Date(data.releaseDate).getFullYear()
    : null;

  // Wishlist toggle button (heart + label) shared by both action branches.
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
      <svg viewBox="0 0 24 24" fill={wishlisted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {wishlisted ? t("store.inWishlist") : t("store.addToWishlist")}
    </button>
  );

  if (isBigScreen && mockGame) {
    return (
      <BigScreenStoreGamePage
        game={mockGame}
        onBack={() => navigate("/store")}
        onAddToLibrary={handleAddToLibrary}
        adding={adding}
        isInLibrary={isInLibrary}
        libraryGameId={libraryGameId}
      />
    );
  }

  return (
    <div className="game-page">
      {/* ── Breadcrumb ──────────────────────────────────────────── */}
      <div className="game-top-bar">
        <button className="game-back-link" onClick={() => navigate("/store")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="brand-text">{t("nav.store")}</span>
        </button>
      </div>

      {/* ── Hero — shared GameHero (unified with the Library game page) ── */}
      <GameHero
        name={data.title}
        bannerUrl={data.images.hero ?? data.images.banner ?? null}
        coverUrl={data.images.cover ?? null}
        logoUrl={data.images.logo ?? null}
        accentSrc={data.images.cover ?? data.images.hero ?? data.images.banner ?? null}
        eyebrow={t("gamePage.store")}
        steamAppId={steamAppId ?? null}
        metaItems={[data.developer, data.publisher, releaseYear, data.sourceName].filter(
          (v): v is string => Boolean(v),
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
                     <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
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
                  steamAppId={steamAppId ?? undefined}
                  variant="prominent"
                  label={t("game.findDownload")}
                />
              </>
            )
        }
      />

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="game-tabs">
        {(["overview", "reviews", "weblinks"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`game-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {t(`game.tab.${tab}`)}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="game-content-grid">
          <div className="game-main-col">
            <AboutSection game={mockGame} />
            <SystemRequirementsCard steamAppId={steamAppId ?? null} />
            <StorylineSection game={mockGame} />
            <ScreenshotsSection
              game={mockGame}
              onOpen={(src) => setLightboxImage(src)}
            />
            <VideosSection game={mockGame} />

            {/* Game Relations Card — IGDB + library cross-ref */}
            <GameRelationsCard
              mode="store"
              currentGame={data}
              similarGames={data.similarGames}
              collectionId={data.collectionId}
              collectionName={data.collection}
            />
          </div>

          <div className="game-side-col">
            <div className="side-group">
              <InfoKpiCard game={mockGame} sizeUnit={sizeUnit} hideStatus />
              <RatingsKpiCard game={mockGame} />
              <TimeToBeatCard game={mockGame} />
            </div>
            <div className="side-group">
              <SpecsCard game={mockGame} />
              <ProtonDBCard steamAppId={steamAppId} />
              <CrackWatchCard gameName={data.title} appId={steamAppId} />
            </div>
            <div className="side-group">
              <ReleasesCard game={mockGame} />
              <LanguagesSection game={mockGame} />
            </div>
          </div>
        </div>
      )}

      {/* ── Reviews ───────────────────────────────────────────────── */}
      {activeTab === "reviews" && (
        <ReviewsTab game={mockGame} onReviewsFetched={handleReviewsFetched} />
      )}

      {/* ── Weblinks ──────────────────────────────────────────────── */}
      {activeTab === "weblinks" && (
        <WebLinksTab game={mockGame} visible={!lightboxImage} />
      )}

      {/* ── Lightbox ──────────────────────────────────────────────── */}
      {lightboxImage && (
        <div
          className="lightbox-backdrop"
          onClick={() => setLightboxImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            cursor: 'zoom-out',
            animation: 'fadeIn var(--transition-fast) ease'
          }}
        >
          <button
            className="lightbox-nav lightbox-nav--prev"
            aria-label={t("storeDetail.prevScreenshot")}
            onClick={(e) => { e.stopPropagation(); stepLightbox(-1); }}
            style={{
              position: 'fixed',
              left: 'var(--space-xl)',
              top: '50%',
              transform: 'translateY(-50%)',
              width: 44, height: 44,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background var(--transition-fast)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 20, height: 20 }}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div
            className="lightbox-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90%',
              maxHeight: '90%',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
          >
            <img src={lightboxImage}             alt={t("storeDetail.fullscreenScreenshot")} style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', display: 'block' }} />
            {mockGame.screenshots && mockGame.screenshots.length > 1 && (
              <div
                className="lightbox-counter"
                style={{
                  position: 'absolute',
                  bottom: 'var(--space-md)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-full)',
                  letterSpacing: '0.4px',
                }}
              >
                {(lightboxIndex < 0 ? 1 : lightboxIndex + 1)} / {mockGame.screenshots.length}
              </div>
            )}
            <button
              className="lightbox-close"
              onClick={() => setLightboxImage(null)}
              style={{
                position: 'absolute',
                top: 'var(--space-md)',
                right: 'var(--space-md)',
                background: 'rgba(0, 0, 0, 0.5)',
                border: 'none',
                borderRadius: '50%',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#fff',
                transition: 'background var(--transition-fast)'
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 18, height: 18 }}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <button
            className="lightbox-nav lightbox-nav--next"
            aria-label={t("storeDetail.nextScreenshot")}
            onClick={(e) => { e.stopPropagation(); stepLightbox(1); }}
            style={{
              position: 'fixed',
              right: 'var(--space-xl)',
              top: '50%',
              transform: 'translateY(-50%)',
              width: 44, height: 44,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background var(--transition-fast)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 20, height: 20 }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
