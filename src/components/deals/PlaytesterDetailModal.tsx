import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PlaytesterGame, PlaytesterGameDetail } from "../../types/deals";
import { titleToSlug } from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { useGames } from "../../context/GameContext";
import { Button } from "../ui";

interface PlaytesterDetailModalProps {
  game: PlaytesterGame | null;
  onClose: () => void;
  onOpenUrl: (url: string | null | undefined) => void;
}

function formatDuration(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  const total = h * 60 + min;
  return `${total}:${String(s).padStart(2, "0")}`;
}

export default function PlaytesterDetailModal({
  game,
  onClose,
  onOpenUrl,
}: PlaytesterDetailModalProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlist();
  const { games } = useGames();

  const [detail, setDetail] = useState<PlaytesterGameDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!game) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [game, handleKeyDown]);

  // Fetch the detail payload when a game is opened.
  useEffect(() => {
    if (!game) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const result = await invoke<PlaytesterGameDetail>(
          "fetch_playtester_game_detail",
          { slug: game.slug },
        );
        if (!cancelled) setDetail(result);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : t("deals.errorPlaytesterDetail"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game, t]);

  const slug = useMemo(() => (game ? titleToSlug(game.title) : ""), [game]);
  const wishlisted = isWishlisted(slug);
  const title = detail?.title || game?.title || "";
  const ownedInLibrary = games.some(
    (g) => g.name.toLowerCase().trim() === title.toLowerCase().trim(),
  );

  if (!game) return null;

  const handleWishlistToggle = () => {
    toggle({
      id: 0,
      name: title,
      slug,
      summary: detail?.description ?? game.description ?? null,
      rating: null,
      aggregatedRating: null,
      coverUrl: detail?.thumbnail ?? game.thumbnail ?? null,
      logoUrl: null,
      genres: detail ? detail.platforms.map((p) => p.name) : game.genres,
      platforms: detail
        ? detail.platforms.map((p) => p.name)
        : game.platform
          ? [game.platform]
          : [],
      firstReleaseDate: detail?.releaseDate ?? null,
      totalRatingCount: 0,
      hypes: 0,
    });
  };

  const handleCopyLink = async () => {
    const url = game.url;
    if (!url) return;
    try {
      if (navigator?.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* clipboard fallback */
    }
  };

  const handleInstall = () => {
    if (detail?.installUrl) void openUrl(detail.installUrl);
  };

  const primaryUrl = detail?.demoUrl ?? game.url;
  const thumbnail = detail?.thumbnail ?? game.thumbnail ?? null;

  return createPortal(
    <div
      className="modal-backdrop deals-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal deals-detail-modal">
        {/* Header */}
        <div className="deals-detail-header">
          {thumbnail ? (
            <div className="deals-detail-poster-wrap">
              <img src={thumbnail} alt={title} className="deals-detail-poster" />
            </div>
          ) : (
            <div className="deals-detail-poster-fallback">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
          )}

          <div className="deals-detail-info">
            <div className="deals-detail-store-strip">
              <span className="deals-detail-store-badge">Playtester</span>

              {game.status && (
                <span
                  className={`pt-detail-status ${
                    game.status.toLowerCase() === "active" ? "active" : ""
                  }`}
                >
                  <span className="pt-card-status-dot" aria-hidden="true" />
                  {detail?.status ?? game.status}
                </span>
              )}

              {ownedInLibrary && (
                <span className="deals-detail-owned-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {t("deals.inLibrary")}
                </span>
              )}

              {wishlisted && (
                <span className="deals-detail-wishlisted-badge">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {t("deals.onWishlist")}
                </span>
              )}
            </div>

            <h2 className="deals-detail-title">{title}</h2>

            <div className="deals-detail-meta-pills">
              {game.kind && (
                <span className="deals-detail-meta-pill">{game.kind}</span>
              )}
              {game.platform && (
                <span className="deals-detail-meta-pill">{game.platform}</span>
              )}
              {game.genres.slice(0, 3).map((g) => (
                <span key={g} className="deals-detail-meta-pill">
                  {g}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="deals-detail-body">
          {loading && (
            <div className="pt-detail-loading">
              <span className="deals-detail-desc">{t("deals.detailsLoading")}</span>
            </div>
          )}

          {!loading && error && (
            <div className="pt-detail-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && detail && (
            <>
              {detail.description && (
                <div className="deals-detail-section">
                  <h3 className="deals-detail-section-title">
                    {t("deals.aboutTitle")}
                  </h3>
                  <p className="deals-detail-desc">{detail.description}</p>
                </div>
              )}

              {(detail.releaseDate || detail.languages || detail.controller) && (
                <div className="deals-detail-section">
                  <div className="pt-detail-meta-grid">
                    {detail.releaseDate && (
                      <div className="pt-detail-meta-row">
                        <span className="pt-detail-meta-label">
                          {t("deals.releaseDate")}
                        </span>
                        <span className="pt-detail-meta-value">
                          {detail.releaseDate}
                        </span>
                      </div>
                    )}
                    {detail.languages && (
                      <div className="pt-detail-meta-row">
                        <span className="pt-detail-meta-label">
                          {t("deals.languages")}
                        </span>
                        <span className="pt-detail-meta-value">
                          {detail.languages}
                        </span>
                      </div>
                    )}
                    {detail.controller && (
                      <div className="pt-detail-meta-row">
                        <span className="pt-detail-meta-label">
                          {t("deals.controller")}
                        </span>
                        <span className="pt-detail-meta-value">
                          {detail.controller}
                        </span>
                      </div>
                    )}
                    {detail.studio && (
                      <div className="pt-detail-meta-row">
                        <span className="pt-detail-meta-label">
                          {t("deals.studio")}
                        </span>
                        <span className="pt-detail-meta-value">
                          {detail.studio}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {detail.platforms.length > 0 && (
                <div className="deals-detail-section">
                  <h3 className="deals-detail-section-title">
                    {t("deals.platforms")}
                  </h3>
                  <div className="pt-detail-platform-links">
                    {detail.platforms.map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        className="deals-detail-lookup-btn"
                        onClick={() => onOpenUrl(p.url)}
                      >
                        {p.name}
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {detail.systemRequirements.length > 0 && (
                <div className="deals-detail-section">
                  <h3 className="deals-detail-section-title">
                    {t("deals.systemRequirements")}
                  </h3>
                  <dl className="pt-detail-reqs">
                    {detail.systemRequirements.map((r) => (
                      <div key={r.label} className="pt-detail-req-row">
                        <dt>{r.label}</dt>
                        <dd>{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {detail.photos.length > 0 && (
                <div className="deals-detail-section">
                  <h3 className="deals-detail-section-title">
                    {t("deals.screenshots")}
                  </h3>
                  <div className="pt-media-strip">
                    {detail.photos.map((photo) => (
                      <button
                        key={photo.url}
                        type="button"
                        className="pt-media-shot"
                        onClick={() => onOpenUrl(photo.url)}
                        title={photo.caption ?? undefined}
                      >
                        <img src={photo.url} alt={photo.caption ?? title} loading="lazy" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {detail.videos.length > 0 && (
                <div className="deals-detail-section">
                  <h3 className="deals-detail-section-title">
                    {t("deals.videos")}
                  </h3>
                  <div className="pt-media-videos">
                    {detail.videos.map((video, i) => (
                      <div key={video.embedUrl ?? i} className="pt-media-video">
                        {video.embedUrl ? (
                          <iframe
                            src={video.embedUrl}
                            title={video.name ?? title}
                            allow="autoplay; fullscreen; picture-in-picture"
                            allowFullScreen
                            loading="lazy"
                          />
                        ) : (
                          <div className="pt-media-video-fallback">
                            {video.name ?? t("deals.videos")}
                          </div>
                        )}
                        <div className="pt-media-video-meta">
                          {video.name && <span>{video.name}</span>}
                          {formatDuration(video.duration) && (
                            <span className="pt-media-video-duration">
                              {formatDuration(video.duration)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(detail.steamdbUrl || detail.studioUrl) && (
                <div className="deals-detail-section">
                  <h3 className="deals-detail-section-title">
                    {t("deals.lookupLinks")}
                  </h3>
                  <div className="deals-detail-links">
                    {detail.steamdbUrl && (
                      <button
                        type="button"
                        className="deals-detail-lookup-btn"
                        onClick={() => onOpenUrl(detail.steamdbUrl)}
                      >
                        SteamDB
                      </button>
                    )}
                    {detail.studioUrl && (
                      <button
                        type="button"
                        className="deals-detail-lookup-btn"
                        onClick={() => onOpenUrl(detail.studioUrl)}
                      >
                        {t("deals.studioPage")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="deals-detail-footer">
          <div className="deals-detail-footer-left">
            <Button
              variant={wishlisted ? "secondary" : "ghost"}
              size="md"
              onClick={handleWishlistToggle}
              leftIcon={
                <svg
                  viewBox="0 0 24 24"
                  fill={wishlisted ? "var(--color-warning)" : "none"}
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ color: wishlisted ? "var(--color-warning)" : "inherit" }}
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              }
            >
              {wishlisted ? t("deals.removeFromWishlist") : t("deals.addToWishlist")}
            </Button>

            <Button
              variant="ghost"
              size="md"
              onClick={handleCopyLink}
              leftIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              }
            >
              {copied ? t("gameInfo.copied") : t("deals.copyLink")}
            </Button>
          </div>

          <div className="deals-detail-footer-right">
            <Button variant="ghost" size="md" onClick={onClose}>
              {t("common.close")}
            </Button>

            {detail?.installUrl && (
              <Button
                variant="secondary"
                size="md"
                onClick={handleInstall}
                leftIcon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                }
              >
                {t("deals.install")}
              </Button>
            )}

            <Button
              variant="primary"
              size="md"
              onClick={() => onOpenUrl(primaryUrl)}
              leftIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              }
            >
              {detail?.demoUrl ? t("deals.viewDemo") : t("deals.viewOnPlaytester")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
