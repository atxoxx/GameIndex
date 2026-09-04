import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import type { AboutBundle, Game, MovieEntry } from "../../types/game";
import { steamCodeForUi } from "../../i18n/languages";
import { getVideoEmbedUrl, getVideoThumbnail } from "./video";
import { IconImage, IconMaximize, IconVideo } from "./icons";

interface GameMediaSpotlightProps {
  game: Game;
  onOpenLightbox: (src: string, index?: number) => void;
  steamAppId?: number | null;
}

type SpotlightItem =
  | { id: string; kind: "movie"; movie: MovieEntry; label: string; thumbUrl: string | null }
  | { id: string; kind: "video"; url: string; label: string; thumbUrl: string | null }
  | { id: string; kind: "screenshot"; src: string; label: string; index: number };

function HlsPlayer({ movie }: { movie: MovieEntry }) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const label = movie.name || t("game.mediaSpotlight.trailer");

  useEffect(() => {
    const video = videoRef.current;
    const src = movie.hlsH264;
    if (!video || !src) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    let hlsInstance: import("hls.js").default | null = null;
    let isCancelled = false;

    import("hls.js").then(({ default: Hls }) => {
      if (isCancelled || !videoRef.current) return;
      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsInstance = hls;
        hls.loadSource(src);
        hls.attachMedia(videoRef.current);
      }
    });

    return () => {
      isCancelled = true;
      if (hlsInstance) {
        hlsInstance.destroy();
      }
    };
  }, [movie.hlsH264]);

  return (
    <video
      ref={videoRef}
      controls
      poster={movie.thumbnail || undefined}
      playsInline
      preload="metadata"
      aria-label={label}
      className="media-spotlight__player"
    />
  );
}

function SteamPlayer({ movie }: { movie: MovieEntry }) {
  const { t } = useLanguage();
  if (movie.hlsH264 && !movie.webm && !movie.mp4) {
    return <HlsPlayer movie={movie} />;
  }
  const sources: { src: string; type: string }[] = [];
  if (movie.webm) sources.push({ src: movie.webm, type: "video/webm" });
  if (movie.mp4) sources.push({ src: movie.mp4, type: "video/mp4" });
  const label = movie.name || t("game.mediaSpotlight.trailer");

  return (
    <video
      controls
      poster={movie.thumbnail || undefined}
      playsInline
      preload="metadata"
      aria-label={label}
      className="media-spotlight__player"
    >
      {sources.map((s) => (
        <source key={s.src} src={s.src} type={s.type} />
      ))}
    </video>
  );
}

export default function GameMediaSpotlight({
  game,
  onOpenLightbox,
  steamAppId: steamAppIdProp,
}: GameMediaSpotlightProps) {
  const { t, language } = useLanguage();
  const [movies, setMovies] = useState<MovieEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const movieFetchRef = useRef(0);

  const effectiveSteamAppId = steamAppIdProp !== undefined ? steamAppIdProp : game.steamAppId;

  // Fetch Steam trailers if available
  useEffect(() => {
    if (!effectiveSteamAppId && !game.name) {
      setMovies([]);
      return;
    }
    let cancelled = false;
    const counter = ++movieFetchRef.current;

    invoke<AboutBundle>("get_about_bundle", {
      steamAppId: effectiveSteamAppId ?? undefined,
      gameName: game.name ?? undefined,
    })
      .then((bundle) => {
        if (cancelled || counter !== movieFetchRef.current) return;
        const payload =
          bundle.byLanguage[steamCodeForUi(language)] ??
          bundle.byLanguage[bundle.defaultLanguage] ??
          Object.values(bundle.byLanguage)[0] ??
          null;
        setMovies(payload?.movies ?? []);
      })
      .catch(() => {
        if (!cancelled && counter === movieFetchRef.current) {
          setMovies([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveSteamAppId, game.name, language]);

  // Unified items list: trailers first, then screenshots
  const items = useMemo<SpotlightItem[]>(() => {
    const list: SpotlightItem[] = [];

    // 1. Steam trailers
    movies.forEach((m, idx) => {
      list.push({
        id: `movie-${m.id || idx}`,
        kind: "movie",
        movie: m,
        label: m.name || `${t("game.mediaSpotlight.trailer")} ${idx + 1}`,
        thumbUrl: m.thumbnail || null,
      });
    });

    // 2. Additional video URLs (if distinct)
    (game.videos || []).forEach((url, idx) => {
      const thumb = getVideoThumbnail(url);
      const thumbUrl = thumb && thumb.kind === "youtube" ? thumb.src : null;
      list.push({
        id: `video-${idx}`,
        kind: "video",
        url,
        label: `${t("game.mediaSpotlight.trailer")} ${movies.length + idx + 1}`,
        thumbUrl,
      });
    });

    // 3. Screenshots
    (game.screenshots || []).forEach((src, idx) => {
      list.push({
        id: `screenshot-${idx}`,
        kind: "screenshot",
        src,
        label: `${t("game.mediaSpotlight.screenshot")} ${idx + 1}`,
        index: idx,
      });
    });

    return list;
  }, [movies, game.videos, game.screenshots, t]);

  // Keep active index in bounds
  const safeIndex = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0;
  const activeItem = items[safeIndex] ?? null;

  // Scroll active thumbnail into view
  useEffect(() => {
    if (!filmstripRef.current) return;
    const activeEl = filmstripRef.current.children[safeIndex] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [safeIndex]);

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (items.length <= 1) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
    }
  };

  const handlePrev = () => {
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
  };

  if (!activeItem || items.length === 0) {
    return null;
  }

  return (
    <section
      className="game-section game-media-spotlight"
      aria-label={t("game.mediaSpotlight.title")}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Header bar */}
      <div className="media-spotlight__header">
        <div className="media-spotlight__title-row">
          <span className="game-section-title__icon" aria-hidden>
            {activeItem.kind === "screenshot" ? <IconImage size={18} /> : <IconVideo size={18} />}
          </span>
          <h2 className="media-spotlight__title">{t("game.mediaSpotlight.title")}</h2>
          <span className="media-spotlight__counter">
            {safeIndex + 1} / {items.length}
          </span>
        </div>

        <div className="media-spotlight__nav-actions">
          {activeItem.kind === "screenshot" && (
            <button
              type="button"
              className="media-spotlight__action-btn"
              onClick={() => onOpenLightbox(activeItem.src, activeItem.index)}
              title={t("game.mediaSpotlight.viewFullscreen")}
            >
              <IconMaximize size={15} />
              <span>{t("game.mediaSpotlight.viewFullscreen")}</span>
            </button>
          )}
          <div className="media-spotlight__arrows">
            <button
              type="button"
              className="media-spotlight__arrow"
              onClick={handlePrev}
              aria-label={t("game.mediaSpotlight.previousMedia")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              className="media-spotlight__arrow"
              onClick={handleNext}
              aria-label={t("game.mediaSpotlight.nextMedia")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main 16:9 Theater View */}
      <div className="media-spotlight__theater">
        {activeItem.kind === "movie" && (
          <div className="media-spotlight__video-container">
            <SteamPlayer movie={activeItem.movie} />
          </div>
        )}

        {activeItem.kind === "video" && (
          <div className="media-spotlight__video-container">
            <iframe
              src={getVideoEmbedUrl(activeItem.url) || undefined}
              title={activeItem.label}
              className="media-spotlight__iframe"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        {activeItem.kind === "screenshot" && (
          <div
            className="media-spotlight__image-container"
            onClick={() => onOpenLightbox(activeItem.src, activeItem.index)}
            role="button"
            tabIndex={0}
            title={t("game.mediaSpotlight.viewFullscreen")}
          >
            <img
              src={activeItem.src}
              alt={activeItem.label}
              className="media-spotlight__image"
              loading="eager"
            />
            <div className="media-spotlight__image-overlay">
              <span className="media-spotlight__expand-pill">
                <IconMaximize size={16} />
                {t("game.mediaSpotlight.viewFullscreen")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Thumbnail Reel Filmstrip */}
      {items.length > 1 && (
        <div className="media-spotlight__filmstrip-wrap">
          <div className="media-spotlight__filmstrip" ref={filmstripRef}>
            {items.map((item, idx) => {
              const isActive = idx === safeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`media-spotlight__thumb ${isActive ? "active" : ""}`}
                  onClick={() => setActiveIndex(idx)}
                  aria-label={item.label}
                  aria-pressed={isActive}
                >
                  {item.kind === "screenshot" ? (
                    <img
                      src={item.src}
                      alt=""
                      className="media-spotlight__thumb-img"
                      loading="lazy"
                    />
                  ) : item.thumbUrl ? (
                    <img
                      src={item.thumbUrl}
                      alt=""
                      className="media-spotlight__thumb-img"
                      loading="lazy"
                    />
                  ) : (
                    <div className="media-spotlight__thumb-fallback">
                      <IconVideo size={20} />
                    </div>
                  )}

                  {item.kind !== "screenshot" ? (
                    <span className="media-spotlight__thumb-badge media-spotlight__thumb-badge--video">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      {t("game.mediaSpotlight.trailer")}
                    </span>
                  ) : (
                    <span className="media-spotlight__thumb-badge media-spotlight__thumb-badge--photo">
                      <IconImage size={10} />
                      {item.index + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
