import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate } from "react-router-dom";
import {
  Check,
  Copy,
  ExternalLink,
  Heart,
  Library,
  MonitorPlay,
} from "lucide-react";
import type { PlaytesterGame, PlaytesterGameDetail } from "../../types/deals";
import { formatExpiry, titleToSlug } from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlistContext } from "../../context/WishlistContext";
import { useOwnedTitles } from "../../hooks/useOwnedTitles";
import { useLibraryGameLookup } from "../../hooks/useLibraryGameLookup";
import { useToast } from "../../context/ToastContext";
import { copyTextToClipboard } from "../../utils/clipboard";
import { Button } from "../ui";
import DealModalShell, {
  DealModalSection,
  DealModalStat,
} from "./DealModalShell";
import { playtesterSummary } from "./dealsSummaries";

interface PlaytesterDetailModalProps {
  game: PlaytesterGame | null;
  onClose: () => void;
  onOpenUrl: (url: string | null | undefined) => void;
}

function formatDuration(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return iso;
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;
  const total = hours * 60 + minutes;
  return `${total}:${String(seconds).padStart(2, "0")}`;
}

/**
 * PlaytesterDetailModal - a playtest / demo detail page in the shared modal
 * frame. Detail metadata is scraped on open, so the list stays fast.
 */
export default function PlaytesterDetailModal({
  game,
  onClose,
  onOpenUrl,
}: PlaytesterDetailModalProps) {
  const { t } = useLanguage();
  const { isWishlisted, toggle } = useWishlistContext();
  const isOwned = useOwnedTitles();
  const findLibraryGame = useLibraryGameLookup();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [detail, setDetail] = useState<PlaytesterGameDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

    void (async () => {
      try {
        const result = await invoke<PlaytesterGameDetail>(
          "fetch_playtester_game_detail",
          { slug: game.slug },
        );
        if (!cancelled) setDetail(result);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : t("deals.errorPlaytesterDetail"),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [game, t]);

  const title = detail?.title || game?.title || "";
  const wishlisted = isWishlisted(title ? titleToSlug(title) : "");
  const owned = Boolean(game) && isOwned(title);
  const thumbnail = detail?.thumbnail ?? game?.thumbnail ?? null;
  const libraryGame = findLibraryGame(title);

  const openGamePage = () => {
    if (!libraryGame) return;
    onClose();
    navigate(`/library/${libraryGame.id}`);
  };

  const metaRows = useMemo(() => {
    if (!detail) return [];
    return [
      { label: t("deals.releaseDate"), value: detail.releaseDate },
      { label: t("deals.languages"), value: detail.languages },
      { label: t("deals.controller"), value: detail.controller },
      { label: t("deals.studio"), value: detail.studio },
    ].filter((row) => Boolean(row.value));
  }, [detail, t]);

  const handleCopy = useCallback(async () => {
    if (!game) return;
    const ok = await copyTextToClipboard(game.url);
    showToast(
      ok ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
      ok ? "success" : "error",
    );
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [game, showToast, t]);

  if (!game) return null;

  const statusTone = game.status.toLowerCase() === "active" ? "success" : "muted";
  const primaryUrl = detail?.demoUrl ?? game.url;

  return (
    <DealModalShell
      open
      onClose={onClose}
      title={title}
      subtitle={
        <>
          {game.kind || "Playtester"}
          {detail?.studio ? ` · ${detail.studio}` : ""}
          {game.platform ? ` · ${game.platform}` : ""}
        </>
      }
      image={thumbnail}
      tint="var(--color-accent)"
      badges={
        <>
          <span className="deals-modal__store">
            <MonitorPlay size={11} aria-hidden="true" />
            Playtester
          </span>
          {game.status && (
            <span
              className={`deals-modal__badge deals-modal__badge--${statusTone}`}
            >
              <i className="deals-modal__status-dot" aria-hidden="true" />
              {detail?.status ?? game.status}
            </span>
          )}
          {owned && (
            <span className="deals-modal__badge deals-modal__badge--owned">
              <Library size={11} aria-hidden="true" />
              {t("deals.inLibrary")}
            </span>
          )}
          {wishlisted && (
            <span className="deals-modal__badge deals-modal__badge--wishlist">
              <Heart size={11} fill="currentColor" aria-hidden="true" />
              {t("deals.onWishlist")}
            </span>
          )}
        </>
      }
      stats={
        <>
          <DealModalStat
            label={t("deals.status")}
            value={detail?.status ?? game.status}
            tone={statusTone === "success" ? "success" : "default"}
          />
          <DealModalStat
            label={t("deals.type")}
            value={game.kind || "—"}
          />
          <DealModalStat
            label={t("deals.platforms")}
            value={detail?.platforms.length ?? (game.platforms.length || 0)}
          />
          <DealModalStat
            label={t("deals.releaseDate")}
            value={detail?.releaseDate ?? "—"}
          />
        </>
      }
      footerLeft={
        <>
          <Button
            variant={wishlisted ? "secondary" : "ghost"}
            size="md"
            onClick={() =>
              toggle(
                playtesterSummary(game, {
                  name: title,
                  summary: detail?.description ?? game.description ?? null,
                  coverUrl: thumbnail,
                  genres: detail ? detail.platforms.map((p) => p.name) : game.genres,
                }),
              )
            }
            leftIcon={
              <Heart
                size={15}
                fill={wishlisted ? "currentColor" : "none"}
                aria-hidden="true"
              />
            }
          >
            {wishlisted
              ? t("deals.removeFromWishlist")
              : t("deals.addToWishlist")}
          </Button>

          <Button
            variant="ghost"
            size="md"
            onClick={handleCopy}
            leftIcon={copied ? <Check size={15} /> : <Copy size={15} />}
          >
            {copied ? t("gameInfo.copied") : t("deals.copyLink")}
          </Button>
        </>
      }
      footerRight={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("common.close")}
          </Button>

          {libraryGame && (
            <Button
              variant="secondary"
              size="md"
              onClick={openGamePage}
              leftIcon={<MonitorPlay size={15} aria-hidden="true" />}
            >
              {t("deals.openGamePage")}
            </Button>
          )}

          {detail?.installUrl && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => void openUrl(detail.installUrl as string)}
            >
              {t("deals.install")}
            </Button>
          )}

          <Button
            variant="primary"
            size="md"
            onClick={() => onOpenUrl(primaryUrl)}
            leftIcon={<ExternalLink size={15} aria-hidden="true" />}
          >
            {detail?.demoUrl ? t("deals.viewDemo") : t("deals.viewOnPlaytester")}
          </Button>
        </>
      }
    >
      {loading && (
        <p className="deals-modal__text deals-modal__muted">
          {t("deals.detailsLoading")}
        </p>
      )}

      {!loading && error && (
        <p className="deals-modal__text deals-modal__text--error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && detail && (
        <>
          {detail.description && (
            <DealModalSection title={t("deals.aboutTitle")}>
              <p className="deals-modal__text">{detail.description}</p>
            </DealModalSection>
          )}

          {metaRows.length > 0 && (
            <DealModalSection title={t("deals.facts")}>
              <dl className="deals-modal__meta-grid">
                {metaRows.map((row) => (
                  <div key={row.label} className="deals-modal__meta-row">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </DealModalSection>
          )}

          {detail.platforms.length > 0 && (
            <DealModalSection title={t("deals.platforms")}>
              <div className="deals-modal__links">
                {detail.platforms.map((platform) => (
                  <button
                    key={platform.name}
                    type="button"
                    className="deals-modal__link"
                    onClick={() => onOpenUrl(platform.url)}
                  >
                    {platform.name}
                    <ExternalLink size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </DealModalSection>
          )}

          {detail.systemRequirements.length > 0 && (
            <DealModalSection title={t("deals.systemRequirements")}>
              <dl className="deals-modal__meta-grid">
                {detail.systemRequirements.map((requirement) => (
                  <div key={requirement.label} className="deals-modal__meta-row">
                    <dt>{requirement.label}</dt>
                    <dd>{requirement.value}</dd>
                  </div>
                ))}
              </dl>
            </DealModalSection>
          )}

          {detail.photos.length > 0 && (
            <DealModalSection title={t("deals.screenshots")}>
              <div className="deals-modal__shots">
                {detail.photos.map((photo) => (
                  <button
                    key={photo.url}
                    type="button"
                    className="deals-modal__shot"
                    onClick={() => onOpenUrl(photo.url)}
                    title={photo.caption ?? title}
                  >
                    <img src={photo.url} alt={photo.caption ?? title} loading="lazy" />
                  </button>
                ))}
              </div>
            </DealModalSection>
          )}

          {detail.videos.length > 0 && (
            <DealModalSection title={t("deals.videos")}>
              <div className="deals-modal__videos">
                {detail.videos.map((video, index) => (
                  <div key={video.embedUrl ?? index} className="deals-modal__video">
                    {video.embedUrl ? (
                      <iframe
                        src={video.embedUrl}
                        title={video.name ?? title}
                        allow="autoplay; fullscreen; picture-in-picture"
                        allowFullScreen
                        loading="lazy"
                      />
                    ) : (
                      <div className="deals-modal__video-fallback">
                        {video.name ?? t("deals.videos")}
                      </div>
                    )}
                    <div className="deals-modal__video-meta">
                      {video.name && <span>{video.name}</span>}
                      {formatDuration(video.duration) && (
                        <span>{formatDuration(video.duration)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </DealModalSection>
          )}

          {(detail.steamdbUrl || detail.studioUrl || detail.added) && (
            <DealModalSection title={t("deals.lookupLinks")}>
              <div className="deals-modal__links">
                {detail.steamdbUrl && (
                  <button
                    type="button"
                    className="deals-modal__link"
                    onClick={() => onOpenUrl(detail.steamdbUrl)}
                  >
                    SteamDB
                    <ExternalLink size={12} aria-hidden="true" />
                  </button>
                )}
                {detail.studioUrl && (
                  <button
                    type="button"
                    className="deals-modal__link"
                    onClick={() => onOpenUrl(detail.studioUrl)}
                  >
                    {t("deals.studioPage")}
                    <ExternalLink size={12} aria-hidden="true" />
                  </button>
                )}
                {detail.added && formatExpiry(detail.added) && (
                  <span className="deals-modal__note">
                    {t("deals.addedOn", {
                      date: formatExpiry(detail.added) as string,
                    })}
                  </span>
                )}
              </div>
            </DealModalSection>
          )}
        </>
      )}
    </DealModalShell>
  );
}
