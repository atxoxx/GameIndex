import { useEffect, useRef, useState, useCallback, useMemo, useContext, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GameMetadataResult, StoreGameSummary } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { WishlistContext } from "../../context/WishlistContext";
import { useProgressiveImage } from "../../hooks/useProgressiveImages";
import {
  useSteamGridArt,
  usePrefetchImage,
} from "../../context/SteamGridDbContext";
import { resolveSteamAppId } from "../../hooks/useGameCardArt";
import { Button } from "../ui";
import StoreSurpriseModal from "./StoreSurpriseModal";

type HeroCategory = "hot" | "weekly" | "trending";

interface StoreFeaturedHeroProps {
  /** Navigate to a game's detail page. */
  onPickGame: (game: StoreGameSummary) => void;
}

const TABS: {
  id: HeroCategory;
  labelKey: string;
  icon: ReactElement;
}[] = [
  {
    id: "hot",
    labelKey: "store.featured.hot",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2c1 3-1 4-1 6 0 1.5 1 2 2 2 2 0 2-2 2-4 3 2 5 5 5 9 0 4-3 7-7 8-3 .7-5-1-6-3-2-3-1-7 1-9 1-2 4-4 5-7z" />
      </svg>
    ),
  },
  {
    id: "weekly",
    labelKey: "store.featured.weekly",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M9 16l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: "trending",
    labelKey: "store.featured.trending",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
];

const HERO_LIMIT = 15;
const SLIDE_DURATION_MS = 8000;

function renderPlatformIcon(platform: string): ReactElement | null {
  const p = platform.toLowerCase();
  if (p.includes("pc") || p.includes("windows")) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-label="PC">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
      </svg>
    );
  }
  if (p.includes("playstation") || p.includes("ps5") || p.includes("ps4")) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-label="PlayStation">
        <path d="M8.9 14.5c.3.5.7.9 1.1 1.2.4.3.9.5 1.4.5.6 0 1.1-.2 1.6-.6.5-.4.8-.9.9-1.5.1-.6 0-1.2-.3-1.7l-4.7-7.9h2.9l3.3 5.7c.3.5.4 1 .4 1.5 0 .5-.2 1-.5 1.4-.3.4-.7.7-1.2.8-.5.1-1 .1-1.5-.1-.5-.2-.9-.5-1.2-.9l-2.2-3.8v5.3zm-5.7 3.9c-1.3-.4-2.2-1.3-2.7-2.7-.5-1.4-.3-2.9.5-4.3l7.9-13.4h2.9L3.9 11.4c-.6 1-.7 2.1-.4 3.1.4 1 1 1.7 2 2 .9.3 1.9.2 2.8-.3.9-.5 1.5-1.2 1.9-2.2l1.4 2.4c-.6 1.4-1.5 2.4-2.8 3.1-1.3.7-2.8.8-4.3.4z" />
      </svg>
    );
  }
  if (p.includes("xbox")) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-label="Xbox">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-2.07 4.19c1.076.62 1.838 1.503 2.07 2.65.232-1.147.994-2.03 2.07-2.65 1.577.818 2.87 2.062 3.708 3.593-.654.516-1.547.88-2.63 1.055-.494.08-1.026.124-1.58.132-.38-.005-.756-.03-1.127-.076-.14-.017-.28-.038-.418-.063-1.083-.175-1.976-.54-2.63-1.055.838-1.53 2.13-2.775 3.707-3.593zM4.19 12c0-1.89.65-3.633 1.74-5.018.57.733 1.488 1.34 2.66 1.737-.587 1.507-.94 3.228-1.01 5.064-.99-.54-1.85-1.36-2.49-2.383-.58.188-.9.37-.9.6z" />
      </svg>
    );
  }
  if (p.includes("switch") || p.includes("nintendo")) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-label="Nintendo">
        <path d="M7.74 0C3.47 0 0 3.47 0 7.74v8.52C0 20.53 3.47 24 7.74 24h1.72V0H7.74zm-2.1 9.4c1.16 0 2.1.94 2.1 2.1 0 1.16-.94 2.1-2.1 2.1-1.16 0-2.1-.94-2.1-2.1 0-1.16.94-2.1 2.1-2.1zM16.26 0h-1.72v24h1.72c4.27 0 7.74-3.47 7.74-7.74V7.74C24 3.47 20.53 0 16.26 0zm2.1 13.6c-1.16 0-2.1-.94-2.1-2.1 0-1.16.94-2.1 2.1-2.1 1.16 0 2.1.94 2.1 2.1 0 1.16-.94 2.1-2.1 2.1z" />
      </svg>
    );
  }
  return null;
}

export default function StoreFeaturedHero({ onPickGame }: StoreFeaturedHeroProps) {
  const { t } = useLanguage();
  const wishlistCtx = useContext(WishlistContext);
  const [tab, setTab] = useState<HeroCategory>("hot");
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [surpriseOpen, setSurpriseOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [metadata, setMetadata] = useState<GameMetadataResult | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);

  const cacheRef = useRef<Partial<Record<HeroCategory, StoreGameSummary[]>>>({});
  const reqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Scroll active dock thumbnail into view
  useEffect(() => {
    const activeEl = itemRefs.current[currentIndex];
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [currentIndex]);

  // Fetch games for the current category tab
  useEffect(() => {
    const cached = cacheRef.current[tab];
    if (cached && cached.length > 0) {
      setGames(cached);
      setCurrentIndex(0);
      setLoading(false);
      return;
    }

    const currentReq = ++reqRef.current;
    setLoading(true);

    const loadCategoryGames = async () => {
      try {
        let results: StoreGameSummary[] = [];

        try {
          results = await invoke<StoreGameSummary[]>("fetch_spotlight_games", {
            category: tab,
            limit: HERO_LIMIT,
          });
        } catch (fetchErr) {
          console.warn("fetch_spotlight_games failed, attempting fallback:", fetchErr);
        }

        // Graceful fallback if category returned empty list
        if (!results || results.length === 0) {
          const fallbackCat = tab === "weekly" ? "top" : tab === "hot" ? "popular" : "trending";
          results = await invoke<StoreGameSummary[]>("fetch_store_games", {
            category: fallbackCat,
            offset: 0,
            limit: HERO_LIMIT,
          });
        }

        if (!results || results.length === 0) {
          results = await invoke<StoreGameSummary[]>("fetch_store_games", {
            category: "all",
            offset: 0,
            limit: HERO_LIMIT,
          });
        }

        if (currentReq === reqRef.current) {
          cacheRef.current[tab] = results;
          setGames(results || []);
          setCurrentIndex(0);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load featured games for tab:", tab, err);
        try {
          const fallback = await invoke<StoreGameSummary[]>("fetch_store_games", {
            category: "all",
            offset: 0,
            limit: HERO_LIMIT,
          });
          if (currentReq === reqRef.current) {
            cacheRef.current[tab] = fallback;
            setGames(fallback || []);
            setCurrentIndex(0);
            setLoading(false);
            return;
          }
        } catch {
          // Both failed
        }
        if (currentReq === reqRef.current) {
          setLoading(false);
        }
      }
    };

    loadCategoryGames();
  }, [tab]);

  const handleNext = useCallback(() => {
    if (games.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % games.length);
  }, [games.length]);

  const handlePrev = useCallback(() => {
    if (games.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + games.length) % games.length);
  }, [games.length]);

  // Autoplay carousel timer
  useEffect(() => {
    if (isPaused || games.length <= 1) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      handleNext();
    }, SLIDE_DURATION_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, games.length, handleNext]);

  const activeGame = games[currentIndex];

  // Reset per-game states when activeGame changes and fetch details
  useEffect(() => {
    setLogoFailed(false);
    setVideoFailed(false);
    setMetadata(null);

    if (!activeGame) return;

    let isMounted = true;
    invoke<GameMetadataResult | null>("get_store_game_detail", { slug: activeGame.slug })
      .then((res) => {
        if (isMounted && res) {
          setMetadata(res);
        }
      })
      .catch(() => {
        // Degrade gracefully
      });

    return () => {
      isMounted = false;
    };
  }, [activeGame?.id, activeGame?.slug]);

  // Extract Steam App ID from game or websites if present
  const steamAppId = useMemo(() => {
    if (!activeGame) return null;
    const resolved = resolveSteamAppId(activeGame);
    if (resolved != null) return String(resolved);
    const websites = activeGame.websites ?? metadata?.websites ?? [];
    for (const url of websites) {
      const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
      if (match) return match[1];
    }
    return null;
  }, [activeGame, metadata]);

  // Determine clear logo candidate
  const clearLogoSrc = useMemo(() => {
    if (!activeGame) return null;
    if (activeGame.logoUrl) return activeGame.logoUrl;
    if (metadata?.images?.logo) return metadata.images.logo;
    if (steamAppId) {
      return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/logo.png`;
    }
    return null;
  }, [activeGame, metadata, steamAppId]);

  // Determine backdrop artwork URL — the IGDB hero is the default, with the
  // Steam CDN hero / screenshots as fallbacks.
  const backdropArtUrl = useMemo(() => {
    if (!activeGame) return "";
    if (metadata?.images?.hero) return metadata.images.hero;
    if (metadata?.images?.banner) return metadata.images.banner;
    if (steamAppId) {
      return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_hero.jpg`;
    }
    if (metadata?.screenshots && metadata.screenshots.length > 0) {
      return metadata.screenshots[0];
    }
    return activeGame.coverUrl ?? "";
  }, [activeGame, metadata, steamAppId]);

  // Determine silent background video trailer URL
  const trailerVideoSrc = useMemo(() => {
    if (videoFailed || !activeGame) return null;
    if (steamAppId) {
      return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/movie480_vp9.webm`;
    }
    return null;
  }, [videoFailed, activeGame, steamAppId]);

  // Subtle pointer parallax for the hero backdrop + poster. Normalized
  // pointer position (0..1) is published as --spot-x / --spot-y on the
  // stage; the CSS translates the artwork by a few pixels against the
  // cursor. Skipped entirely under prefers-reduced-motion.
  const handleStageMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    stage.style.setProperty("--spot-x", x.toFixed(3));
    stage.style.setProperty("--spot-y", y.toFixed(3));
  }, []);

  const handleStageMouseLeave = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty("--spot-x", "0.5");
    stage.style.setProperty("--spot-y", "0.5");
  }, []);

  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const openSurprise = () => setSurpriseOpen(true);

  const handleDockWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  }, []);

  const isWishlisted = activeGame && wishlistCtx ? wishlistCtx.isWishlisted(activeGame.slug) : false;
  const [coverUrl] = useProgressiveImage(activeGame?.coverUrl);
  const [backdropLoadedUrl] = useProgressiveImage(backdropArtUrl);

  // Poster defaults to the IGDB cover (community grid fills in when there's
  // no cover). The hero backdrop prefers the animated SteamGridDB hero,
  // then the Steam CDN banner, then the SteamGridDB banner, then the IGDB
  // hero/cover. Assets are prefetched so animation is ready when a slide
  // becomes active.
  const steamAppIdNum = steamAppId ? parseInt(steamAppId, 10) : null;
  const sgdb = useSteamGridArt(steamAppIdNum);
  usePrefetchImage(sgdb?.gridAnimatedUrl);
  usePrefetchImage(sgdb?.heroAnimatedUrl);
  const steamCdnHero = steamAppId
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_hero.jpg`
    : null;
  const posterSrc = coverUrl ?? sgdb?.gridUrl ?? null;
  const spotlightBackdrop =
    sgdb?.heroAnimatedUrl ?? steamCdnHero ?? sgdb?.heroUrl ?? backdropLoadedUrl ?? coverUrl;


  const releaseYear = activeGame?.firstReleaseDate
    ? new Date(activeGame.firstReleaseDate).getFullYear()
    : null;

  const summaryText = activeGame?.summary || metadata?.description || metadata?.storyline || "";

  return (
    <section
      className="store-spotlight"
      aria-label={t("store.highlightsAria")}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Category selector & Surprise me header */}
      <div className="store-spotlight-top">
        <div className="store-spotlight-tablist" role="tablist" aria-label={t("store.featuredCategoriesAria")}>
          {TABS.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              aria-selected={tab === tabItem.id}
              className={`store-spotlight-tab${tab === tabItem.id ? " active" : ""}`}
              onClick={() => setTab(tabItem.id)}
            >
              <span className="store-spotlight-tab-icon" aria-hidden="true">
                {tabItem.icon}
              </span>
              <span>{t(tabItem.labelKey)}</span>
            </button>
          ))}
        </div>

        <div className="store-spotlight-top-right">
          {games.length > 1 && (
            <div className="store-spotlight-quick-nav">
              <span className="store-spotlight-counter">
                <strong>{String(currentIndex + 1).padStart(2, "0")}</strong>
                <small>/{String(games.length).padStart(2, "0")}</small>
              </span>
              <div className="store-spotlight-nav-arrows">
                <button
                  type="button"
                  className="store-spotlight-arrow-btn"
                  onClick={handlePrev}
                  aria-label={t("store.spotlight.prev")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="store-spotlight-arrow-btn"
                  onClick={handleNext}
                  aria-label={t("store.spotlight.next")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            className="store-featured-surprise"
            onClick={openSurprise}
            title={t("store.surpriseTitle")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
            <span>{t("store.surpriseMe")}</span>
          </button>
        </div>
      </div>

      {/* Main Spotlight Showcase */}
      {loading ? (
        <div className="store-spotlight-stage store-spotlight-stage--loading">
          <div className="store-spotlight-skeleton-backdrop" />
          <div className="store-spotlight-skeleton-info">
            <div className="skeleton-line skeleton-title" style={{ width: "60%" }} />
            <div className="skeleton-line skeleton-subtitle" style={{ width: "40%" }} />
            <div className="skeleton-line skeleton-subtitle" style={{ width: "80%", marginTop: "12px" }} />
          </div>
        </div>
      ) : !activeGame ? (
        <div className="store-spotlight-stage store-spotlight-stage--empty">
          <div className="store-spotlight-body">
            <h2 className="store-spotlight-title">{t("store.noGames")}</h2>
            <p style={{ color: "var(--color-text-secondary)", margin: "8px 0 16px" }}>{t("store.noGamesHint")}</p>
            <Button variant="secondary" size="sm" onClick={() => setTab("hot")}>
              {t("common.reset")}
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="store-spotlight-stage"
          ref={stageRef}
          onMouseMove={reduceMotion ? undefined : handleStageMouseMove}
          onMouseLeave={reduceMotion ? undefined : handleStageMouseLeave}
        >
          {/* Animated Background Mesh, Backdrop & Silent Video Trailer */}
          <div className="store-spotlight-bg" aria-hidden="true">
            {trailerVideoSrc ? (
              <video
                key={trailerVideoSrc}
                src={trailerVideoSrc}
                poster={spotlightBackdrop || undefined}
                autoPlay
                muted
                loop
                playsInline
                className="store-spotlight-bg-video"
                onError={() => setVideoFailed(true)}
              />
            ) : spotlightBackdrop ? (
              <img
                key={`${activeGame.id}-${spotlightBackdrop}`}
                src={spotlightBackdrop}
                alt=""
                className="store-spotlight-bg-img"
              />
            ) : null}
            <div className="store-spotlight-scrim" />
            <div className="store-spotlight-mesh" />
          </div>

          {/* Left Details Pane */}
          <div className="store-spotlight-body">
            <div className="store-spotlight-badge-cluster">
              <span className="store-spotlight-tag">
                <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11" aria-hidden="true">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                {t("store.spotlight.featuredTag")}
              </span>

              {trailerVideoSrc && !videoFailed && (
                <span className="store-spotlight-trailer-pill">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>Trailer</span>
                </span>
              )}

              {activeGame.rating != null && (
                <span className="store-spotlight-rating" title={t("store.spotlight.rating", { score: Math.round(activeGame.rating) })}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  {Math.round(activeGame.rating)}%
                </span>
              )}

              {releaseYear != null && (
                <span className="store-spotlight-year">{releaseYear}</span>
              )}
            </div>

            {/* Clear Logo or Styled Title Fallback */}
            {clearLogoSrc && !logoFailed ? (
              <div className="store-spotlight-logo-wrap" onClick={() => onPickGame(activeGame)}>
                <img
                  key={clearLogoSrc}
                  src={clearLogoSrc}
                  alt={activeGame.name}
                  className="store-spotlight-logo"
                  onError={() => setLogoFailed(true)}
                />
              </div>
            ) : (
              <h2 className="store-spotlight-title" title={activeGame.name} onClick={() => onPickGame(activeGame)}>
                {activeGame.name}
              </h2>
            )}

            {/* Synopsis / Summary */}
            {summaryText && (
              <p className="store-spotlight-summary">
                {summaryText}
              </p>
            )}

            {/* Genres & Platforms Cluster */}
            <div className="store-spotlight-meta-row">
              {activeGame.genres && activeGame.genres.length > 0 && (
                <div className="store-spotlight-genres">
                  {activeGame.genres.slice(0, 3).map((genre) => (
                    <span key={genre} className="store-spotlight-genre-pill">
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              {activeGame.platforms && activeGame.platforms.length > 0 && (
                <div className="store-spotlight-platforms">
                  {activeGame.platforms.slice(0, 3).map((plat) => {
                    const icon = renderPlatformIcon(plat);
                    return (
                      <span key={plat} className="store-spotlight-platform-item" title={plat}>
                        {icon}
                        <span>{plat.replace(/\s*\(.*?\)\s*/g, "")}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* CTAs & Slide Navigation */}
            <div className="store-spotlight-actions">
              <Button
                variant="primary"
                size="md"
                className="store-spotlight-cta"
                onClick={() => onPickGame(activeGame)}
              >
                <span>{t("store.spotlight.explore")}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Button>

              {wishlistCtx && (
                <button
                  type="button"
                  className={`store-spotlight-wishlist${isWishlisted ? " active" : ""}`}
                  onClick={() => wishlistCtx.toggle(activeGame)}
                  title={isWishlisted ? t("store.spotlight.wishlisted") : t("store.spotlight.addToWishlist")}
                  aria-pressed={isWishlisted}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill={isWishlisted ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  <span>{isWishlisted ? t("store.spotlight.wishlisted") : t("store.spotlight.addToWishlist")}</span>
                </button>
              )}
            </div>
          </div>

          {/* Right Showcase 3D Poster / Preview */}
          <div className="store-spotlight-media" onClick={() => onPickGame(activeGame)}>
            <div className="store-spotlight-card-wrap">
              {posterSrc ? (
                <img src={posterSrc} alt={activeGame.name} className="store-spotlight-poster" />
              ) : (
                <div className="store-spotlight-poster-placeholder" />
              )}
              <div className="store-spotlight-poster-gloss" />
            </div>
          </div>
        </div>
      )}

      {/* Thumbnails reel spanning bottom dock */}
      {games.length > 1 && (
        <div
          className="store-spotlight-dock"
          onWheel={handleDockWheel}
          role="tablist"
          aria-label={t("store.spotlight.slideIndicator", { current: currentIndex + 1, total: games.length })}
        >
          <div className="store-spotlight-dock-reel">
            {games.map((game, idx) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={game.id}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`store-spotlight-dock-item${isActive ? " active" : ""}`}
                  onClick={() => setCurrentIndex(idx)}
                  title={game.name}
                >
                  {game.coverUrl ? (
                    <img src={game.coverUrl} alt={game.name} loading="lazy" />
                  ) : (
                    <div className="store-spotlight-dock-placeholder" />
                  )}
                  <span className="store-spotlight-dock-name">{game.name}</span>
                  {isActive && !isPaused && (
                    <div className="store-spotlight-dock-progress" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {surpriseOpen && (
        <StoreSurpriseModal
          onClose={() => setSurpriseOpen(false)}
          onOpenGame={onPickGame}
        />
      )}
    </section>
  );
}
