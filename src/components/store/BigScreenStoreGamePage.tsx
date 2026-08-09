import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import type { ReactNode } from "react";
import type { Game, GameMetadataResult } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useStoreCache } from "../../hooks/useStoreCache";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import PlayerCountBadge from "../PlayerCountBadge";
import DownloadModal from "../DownloadModal";
import BigScreenHeroBackground from "../game/BigScreenHeroBackground";
import SpecsCard from "../game/SpecsCard";
import ReleasesCard from "../game/ReleasesCard";
import LanguagesSection from "../game/LanguagesSection";
import ScreenshotsSection from "../game/ScreenshotsSection";
import VideosSection from "../game/VideosSection";
import StorylineSection from "../game/StorylineSection";
import AboutSection from "../game/AboutSection";
import SystemRequirementsCard from "../game/SystemRequirementsCard";
import RatingsKpiCard from "../game/RatingsKpiCard";
import TimeToBeatCard from "../game/TimeToBeatCard";
import CrackWatchCard from "../CrackWatchCard";
import GameRelationsCard from "../GameRelationsCard";
import ReviewsTab from "../ReviewsTab";
import WebLinksTab from "../WebLinksTab";
import BigScreenPill from "../bigscreen/BigScreenPill";
import BigScreenMetaStrip from "../bigscreen/BigScreenMetaStrip";
import BigScreenLightbox from "../bigscreen/BigScreenLightbox";
import BigScreenTabBar, { type TabDef } from "../bigscreen/BigScreenTabBar";
import BigScreenTabPanel from "../bigscreen/BigScreenTabPanel";
import { extractYear } from "../bigscreen/bigscreenFormat";

type StorePageTab = "overview" | "media" | "specs" | "more";

const STORE_PAGE_TABS: TabDef<StorePageTab>[] = [
  { id: "overview", label: "game.tab.overview", icon: <OverviewIcon /> },
  { id: "media", label: "game.tab.media", icon: <MediaIcon /> },
  { id: "specs", label: "game.tab.specs", icon: <SpecsIcon /> },
  { id: "more", label: "game.tab.more", icon: <MoreIcon /> },
];

/**
 * BigScreenStoreGamePage — controller-first store game detail page.
 *
 * Self-contained: resolves the game from the route slug (`/store/:gameSlug`)
 * via the `get_store_game_detail` backend command, with a fresh
 * `useStoreCache` detail hit as an instant fallback, then builds the rich
 * `Game` object the shared game components consume. Registered as a
 * prop-free bigscreen variant in the route registry.
 */
export default function BigScreenStoreGamePage() {
  const gamepad = useGamepad();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { gameSlug } = useParams<{ gameSlug: string }>();
  const { games, addStoreGame } = useGames();
  const { showToast } = useToast();
  const { getDetailCache, setDetailCache } = useStoreCache();

  // ── Data resolution ───────────────────────────────────────────
  // Cache/API fns are read through a ref so their identities changing
  // on cache writes don't re-fire the fetch effect.
  const [data, setData] = useState<GameMetadataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Tab + Lightbox state
  const [activeTab, setActiveTab] = useState<StorePageTab>("overview");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);

  const cacheApiRef = useRef({ getDetailCache, setDetailCache });
  cacheApiRef.current = { getDetailCache, setDetailCache };

  const [reloadKey, setReloadKey] = useState(0);

  // Abort-safe detail fetch with a fresh-cache fast path.
  useEffect(() => {
    if (!gameSlug) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLogoError(false);
    const cached = cacheApiRef.current.getDetailCache(gameSlug);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    invoke<GameMetadataResult | null>("get_store_game_detail", { slug: gameSlug })
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setData(result);
          void cacheApiRef.current.setDetailCache(gameSlug, result);
        } else {
          setData(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameSlug, reloadKey]);

  // Extract Steam app id from websites
  const steamAppIdFromWebsites = useMemo(() => {
    if (!data?.websites) return undefined;
    for (const url of data.websites) {
      const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }
    return undefined;
  }, [data]);

  // Build a rich Game object from the IGDB metadata so the shared
  // game components (InfoKpiCard, RatingsKpiCard, etc.) can render
  // the same cards they render on the desktop StoreGameDetail page.
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
      steamAppId: steamAppIdFromWebsites,

      // ── Library defaults ────────────────────────────────────
      playStatus: "backlog",
    };
  }, [data, steamAppIdFromWebsites]);

  // Steam appid resolution
  const { appId: steamAppId } = useSteamAppId(mockGame);
  const resolvedSteamAppId =
    typeof steamAppId === "number" ? steamAppId : mockGame?.steamAppId ?? null;

  // Check if already in library (name match against the library rows)
  const existingInLibrary = useMemo(() => {
    if (!data) return null;
    const norm = data.title.toLowerCase().trim();
    return games.find((g) => g.name.toLowerCase().trim() === norm) ?? null;
  }, [data, games]);

  const isInLibrary = !!existingInLibrary;
  const libraryGameId = existingInLibrary?.id;

  // Controller B / Escape goes BACK to the store grid. Registered
  // through the gamepad back-handler registry: the engine invokes the
  // top-priority handler on B (and defers to open overlays
  // automatically). The unregister fn runs on unmount so the shell
  // reclaims B when the user leaves the page.
  const handleBack = useCallback(() => {
    navigate("/store");
  }, [navigate]);

  useEffect(() => {
    return gamepad.registerBackHandler(handleBack, 0);
  }, [gamepad.registerBackHandler, handleBack]);

  // Start on the primary store action so the first controller press
  // has an obvious, useful destination.
  useEffect(() => {
    const firstAction = pageRef.current?.querySelector<HTMLElement>(
      '.bigscreen-gamepage-hero-actions [tabindex="0"]:not([disabled])',
    );
    firstAction?.focus({ preventScroll: true });
  }, [mockGame?.id]);

  // Bumper tab cycling
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      if (lightbox) return;
      setActiveTab((prev) => {
        const idx = STORE_PAGE_TABS.findIndex((t) => t.id === prev);
        const nextIdx =
          direction === "forward"
            ? (idx + 1) % STORE_PAGE_TABS.length
            : (idx - 1 + STORE_PAGE_TABS.length) % STORE_PAGE_TABS.length;
        return STORE_PAGE_TABS[nextIdx].id;
      });
    }, 1);
  }, [gamepad.registerTabCycler, lightbox]);

  const handleAddToLibrary = useCallback(async () => {
    if (!data || adding) return;
    setAdding(true);
    try {
      await addStoreGame(data);
    } catch (err) {
      showToast(t("storeDetail.addFailed", { error: err }), "error");
    } finally {
      setAdding(false);
    }
  }, [data, adding, addStoreGame, showToast, t]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const focusableBack = useFocusable(handleBack);
  const focusableRetry = useFocusable(retry);
  const focusableAction = useFocusable(() => {
    if (isInLibrary && libraryGameId) {
      navigate(`/library/${libraryGameId}`);
    } else {
      void handleAddToLibrary();
    }
  });

  const focusableTrailer = useFocusable(() => {
    if (!mockGame?.videos || mockGame.videos.length === 0) return;
    setLightbox(mockGame.videos[0]);
  });

  const focusableDownload = useFocusable(() => setDownloadOpen(true));

  // ── Render states ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bigscreen-gamepage">
        <div className="store-tab-loading" role="status" aria-live="polite">
          <div className="store-spinner" />
          <span>{t("store.loadingGameDetails")}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bigscreen-gamepage">
        <div className="store-tab-loading" role="alert">
          <strong>{t("store.failedToLoad")}</strong>
          <span>{error}</span>
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--secondary"
            {...focusableRetry}
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!data || !mockGame) {
    return (
      <div className="bigscreen-gamepage">
        <div className="store-tab-loading" role="status">
          <strong>{t("game.notFoundTitle")}</strong>
          <span>{t("store.gameNotFoundIgdb")}</span>
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--secondary"
            {...focusableBack}
          >
            {t("store.backToStore")}
          </button>
        </div>
      </div>
    );
  }

  const game = mockGame;

  const releaseYear = extractYear(game.releaseDate);
  const rating = game.igdbRating ?? game.criticRating;

  return (
    <div ref={pageRef} className="bigscreen-gamepage">
      {/* ── Hero (pauses on Overview) ── */}
      <section className="bigscreen-gamepage-hero" aria-label={t("bigscreen.store.gameBanner", { name: game.name })}>
        <BigScreenHeroBackground
          bannerUrl={game.bannerUrl}
          coverArtUrl={game.coverArtUrl}
          screenshots={game.screenshots}
          videos={game.videos}
          paused={activeTab === "overview"}
        />
        <div className="bigscreen-gamepage-hero-mask" aria-hidden />
        <div className="bigscreen-gamepage-hero-glow" aria-hidden />

        <div className="bigscreen-gamepage-hero-content">
          <button
            type="button"
            className="bigscreen-gamepage-hero-back"
            {...focusableBack}
            aria-label={t("store.backToStore")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="22" height="22">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>{t("nav.store")}</span>
          </button>

          <div className="bigscreen-gamepage-hero-info">
            {(() => {
              const effectiveLogo = game.logoUrl || (resolvedSteamAppId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${resolvedSteamAppId}/logo.png` : null);
              return effectiveLogo && !logoError ? (
                <img
                  src={effectiveLogo}
                  alt={game.name}
                  className="bigscreen-gamepage-hero-logo"
                  width={480}
                  height={140}
                  onError={() => setLogoError(true)}
                />
              ) : (
                <h1 className="bigscreen-gamepage-hero-title">{game.name}</h1>
              );
            })()}
            <div className="bigscreen-gamepage-hero-subtitle-row">
              {game.developer && (
                <span className="bigscreen-gamepage-hero-subtitle">{game.developer}</span>
              )}
              {releaseYear && <span className="bigscreen-gamepage-hero-subtitle-dot" />}
              {releaseYear && (
                <span className="bigscreen-gamepage-hero-subtitle">{releaseYear}</span>
              )}
            </div>
          </div>

          <div className="bigscreen-gamepage-hero-actions">
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--primary"
              {...focusableAction}
              disabled={adding}
            >
              {isInLibrary ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{t("store.inLibrary")}</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                   <span>{adding ? t("store.adding") : t("store.addToLibrary")}</span>
                </>
              )}
            </button>

            {!isInLibrary && (
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--secondary"
                {...focusableDownload}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>{t("game.findDownload")}</span>
              </button>
            )}

            {game.videos && game.videos.length > 0 && (
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--secondary"
                {...focusableTrailer}
                aria-label={t("game.watchTrailer")}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden width="20" height="20">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
                <span>{t("game.trailer")}</span>
              </button>
            )}

            {downloadOpen && (
              <DownloadModal
                gameName={game.name}
                steamAppId={resolvedSteamAppId || undefined}
                onClose={() => setDownloadOpen(false)}
              />
            )}
          </div>
        </div>
      </section>

      {/* ── Metadata pills ── */}
      <BigScreenMetaStrip aria-label={t("bigscreen.store.gameMetadata")} className="bigscreen-gamepage-meta-strip">
        <BigScreenPill tone="accent" size="md">
          {game.platform}
        </BigScreenPill>
        {resolvedSteamAppId != null && (
          <BigScreenPill tone="muted" size="md">
            <PlayerCountBadge appId={resolvedSteamAppId} className="bigscreen-steam-players" /> {t("bigscreen.store.onSteamHydra")}
          </BigScreenPill>
        )}
        {rating != null && rating > 0 && (
          <BigScreenPill tone="muted" size="md" icon={
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden width="14" height="14">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          }>
            {t("bigscreen.store.pctRating", { pct: Math.round(rating) })}
          </BigScreenPill>
        )}
      </BigScreenMetaStrip>

      {/* ── Tab bar ── */}
      <BigScreenTabBar
        tabs={STORE_PAGE_TABS.map((tab) => ({ ...tab, label: t(tab.label) }))}
        activeTab={activeTab}
        onActivate={setActiveTab}
        ariaLabel={t("bigscreen.store.detailsSections")}
      />

      {/* ── Scroll regions ── */}
      <div className="bigscreen-gamepage-tab-scroll-region">
        <BigScreenTabPanel tabId="overview" activeTab={activeTab}>
          <div className="bigscreen-gamepage-overview">
            <StorylineSection game={game} />
            <AboutSection game={game} />
          </div>
        </BigScreenTabPanel>

        <BigScreenTabPanel tabId="media" activeTab={activeTab}>
          <div className="bigscreen-gamepage-media">
            <ScreenshotsSection game={game} onOpen={setLightbox} />
            <VideosSection game={game} />
          </div>
        </BigScreenTabPanel>

        <BigScreenTabPanel tabId="specs" activeTab={activeTab}>
          <div className="bigscreen-gamepage-specs">
            <div className="bigscreen-gamepage-2col" data-cols="2">
              <SpecsCard game={game} />
              <ReleasesCard game={game} />
            </div>
            <div className="bigscreen-gamepage-2col" data-cols="2">
              <TimeToBeatCard game={game} />
              <RatingsKpiCard game={game} />
            </div>
            <LanguagesSection game={game} />
            <SystemRequirementsCard steamAppId={resolvedSteamAppId} />
            <CrackWatchCard gameName={game.name} appId={resolvedSteamAppId} />
          </div>
        </BigScreenTabPanel>

        <BigScreenTabPanel tabId="more" activeTab={activeTab}>
          <div className="bigscreen-gamepage-more">
            <GameRelationsCard
              mode="store"
              currentGame={game}
              similarGames={game.similarGames}
              collectionId={game.collectionId}
              collectionName={game.collection}
            />
            <ReviewsTab game={game} />
            <WebLinksTab game={game} visible={true} />
          </div>
        </BigScreenTabPanel>
      </div>

      <BigScreenLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

// ── Tab icons ──

function OverviewIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function MediaIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function SpecsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function MoreIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}
