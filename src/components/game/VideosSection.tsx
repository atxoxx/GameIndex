import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import type { AboutBundle, Game, MovieEntry } from "../../types/game";
import { steamCodeForUi } from "../../i18n/languages";
import { IconVideo } from "./icons";
import { getVideoEmbedUrl, getVideoThumbnail } from "./video";
import { useBigScreen } from "../../context/BigScreenContext";
import { useFocusable } from "../../hooks/useFocusable";

/**
 * VideosSection
 *
 *  Unified "Media" surface for the Game page. Merges Steam gameplay
 *  trailers (from the about-bundle) with external YouTube/Twitch links
 *  into a single player + thumbnail selector — one big player on top,
 *  a snap-aligned strip of thumbnails below. Selecting a trailer plays
 *  a native `<video>`; selecting an external link swaps in the embed.
 */

interface VideosSectionProps {
  game: Game;
}

type MediaItem =
  | { key: string; kind: "movie"; movie: MovieEntry }
  | { key: string; kind: "video"; url: string };

const PlayGlyph = (
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

function BigScreenVideoSelectorBtn({
  itemKey,
  active,
  label,
  onSelect,
  children,
}: {
  itemKey: string;
  active: boolean;
  label: string;
  onSelect: (key: string) => void;
  children: React.ReactNode;
}) {
  const focusProps = useFocusable(() => onSelect(itemKey));
  return (
    <button
      type="button"
      {...focusProps}
      className={`video-selector-btn ${active ? "active" : ""}`}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

/**
 * Player for newer Steam trailers that ship only an HLS playlist
 * (`.m3u8`, H.264). Native HLS where the platform supports it,
 * hls.js (MSE) everywhere else — Steam's CDN sends CORS headers.
 */
function HlsMoviePlayer({ movie }: { movie: MovieEntry }) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const label = movie.name || t("game.trailer");

  useEffect(() => {
    const video = videoRef.current;
    const src = movie.hlsH264;
    if (!video || !src) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => {
        hls.destroy();
      };
    }
  }, [movie.hlsH264]);

  return (
    <div className="videos-main-video-wrap">
      <video
        ref={videoRef}
        controls
        poster={movie.thumbnail || undefined}
        playsInline
        preload="metadata"
        aria-label={label}
        className="videos-main-video"
      />
    </div>
  );
}

/** Native player for a Steam trailer (webm preferred, mp4 fallback). */
function SteamMoviePlayer({ movie }: { movie: MovieEntry }) {
  const { t } = useLanguage();
  if (movie.hlsH264 && !movie.webm && !movie.mp4) {
    return <HlsMoviePlayer movie={movie} />;
  }
  const sources: { src: string; type: string }[] = [];
  if (movie.webm) sources.push({ src: movie.webm, type: "video/webm" });
  if (movie.mp4) sources.push({ src: movie.mp4, type: "video/mp4" });
  const label = movie.name || t("game.trailer");
  return (
    <div className="videos-main-video-wrap">
      <video
        controls
        poster={movie.thumbnail || undefined}
        playsInline
        preload="metadata"
        aria-label={label}
        className="videos-main-video"
      >
        {sources.map((s) => (
          <source key={s.src} src={s.src} type={s.type} />
        ))}
      </video>
    </div>
  );
}

/** Thumbnail inner content for one media item (trailer / video). */
function MediaThumb({ item }: { item: MediaItem }) {
  if (item.kind === "movie") {
    if (item.movie.thumbnail) {
      return (
        <>
          <img
            src={item.movie.thumbnail}
            alt=""
            loading="lazy"
            className="video-selector-img"
          />
          <span className="video-selector-play-overlay">{PlayGlyph}</span>
        </>
      );
    }
    return <span className="video-selector-fallback">{PlayGlyph}</span>;
  }

  const thumb = getVideoThumbnail(item.url);
  if (thumb?.kind === "youtube") {
    return (
      <>
        <img
          src={thumb.src}
          alt=""
          loading="lazy"
          className="video-selector-img"
        />
        <span className="video-selector-play-overlay">{PlayGlyph}</span>
      </>
    );
  }
  if (thumb?.kind === "twitch") {
    return (
      <span className="video-selector-twitch">
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.714 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
        </svg>
      </span>
    );
  }
  return <span className="video-selector-fallback">{PlayGlyph}</span>;
}

export default function VideosSection({ game }: VideosSectionProps) {
  const { t, language } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [movies, setMovies] = useState<MovieEntry[]>([]);
  const movieFetchCounter = useRef(0);
  const selectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!game.steamAppId && !game.name) return;
    let cancelled = false;
    const myCounter = ++movieFetchCounter.current;
    invoke<AboutBundle>("get_about_bundle", {
      steamAppId: game.steamAppId ?? undefined,
      gameName: game.name ?? undefined,
    })
      .then((bundle) => {
        if (cancelled || myCounter !== movieFetchCounter.current) return;
        const payload =
          bundle.byLanguage[steamCodeForUi(language)] ??
          bundle.byLanguage[bundle.defaultLanguage] ??
          Object.values(bundle.byLanguage)[0] ??
          null;
        setMovies(payload?.movies ?? []);
      })
      .catch(() => {
        if (!cancelled) setMovies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [game.steamAppId, game.name, language]);

  const items = useMemo<MediaItem[]>(() => {
    const list: MediaItem[] = [
      ...movies.map<MediaItem>((m) => ({
        key: `movie-${m.id}`,
        kind: "movie",
        movie: m,
      })),
      ...(game.videos ?? []).map<MediaItem>((url, i) => ({
        key: `video-${i}-${url}`,
        kind: "video",
        url,
      })),
    ];
    return list;
  }, [movies, game.videos]);

  if (items.length === 0) return null;

  const active = items.find((it) => it.key === activeKey) ?? items[0];
  const embedUrl = active.kind === "video" ? getVideoEmbedUrl(active.url) : null;

  const scrollSelector = (dir: 1 | -1) => {
    const el = selectorRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className="game-section videos-section">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconVideo size={16} />
        </span>
        {t("videos.title")}
        <span className="game-section-title__count">{items.length}</span>
      </h2>

      <div className="videos-container">
        {active.kind === "movie" ? (
          <SteamMoviePlayer movie={active.movie} />
        ) : embedUrl ? (
          <div className="video-iframe-wrapper">
            <iframe
              src={embedUrl}
              title={t("videos.iframeTitle", { name: game.name })}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="videos-empty">{t("videos.invalidLink")}</p>
        )}

        {items.length > 1 && (
          <div className="carousel-wrap">
            <button
              type="button"
              className="carousel-arrow carousel-arrow--prev"
              aria-label={t("videos.scrollTrailersLeft")}
              onClick={() => scrollSelector(-1)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="video-selector-list" ref={selectorRef}>
              {items.map((item, idx) => {
                const isSelected = active.key === item.key;
                const label = t("videos.playTrailerAria", { n: idx + 1 });
                const inner = <MediaThumb item={item} />;

                if (isBigScreen) {
                  return (
                    <BigScreenVideoSelectorBtn
                      key={item.key}
                      itemKey={item.key}
                      active={isSelected}
                      label={label}
                      onSelect={setActiveKey}
                    >
                      {inner}
                    </BigScreenVideoSelectorBtn>
                  );
                }

                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`video-selector-btn ${isSelected ? "active" : ""}`}
                    onClick={() => setActiveKey(item.key)}
                    aria-label={label}
                    aria-pressed={isSelected}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="carousel-arrow carousel-arrow--next"
              aria-label={t("videos.scrollTrailersRight")}
              onClick={() => scrollSelector(1)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
