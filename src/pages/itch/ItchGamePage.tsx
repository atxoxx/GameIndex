import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Gamepad2,
  Loader2,
  RefreshCw,
  Star,
} from "lucide-react";
import type { ItchGameDetail, ItchUpload } from "../../types/itch";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useDownloads } from "../../context/DownloadContext";
import { usePresenceActivity } from "../../context/PresenceContext";
import { Button } from "../../components/ui";
import { sanitizeNewsHtml } from "../../components/news/newsContent";
import { formatNumber } from "../../utils/localeFormat";
import { formatItchPrice } from "../deals/itchConstants";
import "../../styles/page-itch.css";

/**
 * The in-app itch.io game page.
 *
 * Route: `/itch/:author/:game` — the two path segments itch itself uses.
 * The page is the launch pad: play a browser build in the player window, buy on
 * itch.io, or hand a downloadable upload to the app's download engine (itch
 * resolves the actual file to a short-lived signed URL via its CSRF-protected
 * download endpoint, see `features/itch/browse.ts`).
 */
export default function ItchGamePage() {
  const { author = "", game = "" } = useParams<{ author: string; game: string }>();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { defaultDownloadPath, addDirectDownload } = useDownloads();

  const [detail, setDetail] = useState<ItchGameDetail | null>(null);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Discord presence: show the itch.io game (cover, author, page link) while
  // this route is open instead of the generic "browsing" line.
  usePresenceActivity(
    "itch-game",
    detail
      ? {
          kind: "itch",
          title: detail.title,
          subtitle: detail.author || undefined,
          url: detail.url,
          image: detail.coverUrl ?? undefined,
        }
      : null,
  );

  useEffect(() => {
    if (!author || !game) {
      setLoading(false);
      setError(t("itch.badRoute"));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<ItchGameDetail>("fetch_itch_game_detail", { url: `${author}/${game}` })
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [author, game, nonce, t]);

  const openExternal = useCallback(
    async (url: string | null | undefined) => {
      if (!url) return;
      try {
        await invoke("open_deal_url", { url });
      } catch (err) {
        showToast(err instanceof Error ? err.message : t("deals.errorOpenLink"), "error");
      }
    },
    [showToast, t],
  );

  const playInApp = useCallback(async () => {
    if (!detail) return;
    setPlaying(true);
    try {
      await invoke("open_itch_player", {
        gameId: detail.id || detail.slug,
        title: detail.title,
        playUrl: detail.playUrl,
        pageUrl: detail.url,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("itch.playFailed"), "error");
    } finally {
      setPlaying(false);
    }
  }, [detail, showToast, t]);

  const downloadUpload = useCallback(
    async (upload: ItchUpload) => {
      if (!detail) return;
      if (!defaultDownloadPath) {
        showToast(t("itch.setDownloadFolder"), "error");
        return;
      }
      setDownloading(upload.id);
      try {
        const target = await invoke<{ url: string; external: boolean }>(
          "resolve_itch_download",
          { url: detail.url, uploadId: upload.id, fileName: upload.name },
        );
        const folder = defaultDownloadPath.replace(/[\\/]+$/, "");
        const savePath = `${folder}/${upload.name}`;
        await addDirectDownload(
          target.url,
          savePath,
          null,
          "itch.io",
          /\.(zip|rar|7z|tar|gz)$/i.test(upload.name),
        );
        showToast(t("itch.downloadQueued", { name: upload.name }), "success");
      } catch (err) {
        showToast(err instanceof Error ? err.message : t("itch.downloadFailed"), "error");
      } finally {
        setDownloading(null);
      }
    },
    [detail, defaultDownloadPath, addDirectDownload, showToast, t],
  );

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/deals");
  };

  if (loading) {
    return (
      <div className="itch-page page">
        <div className="itch-state" role="status" aria-live="polite">
          <Loader2 size={22} className="itch-state__spinner" aria-hidden="true" />
          <p>{t("itch.loading")}</p>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="itch-page page">
        <div className="itch-state">
          <h1>{t("itch.loadFailed")}</h1>
          <p>{error ?? t("itch.loadFailedBody")}</p>
          <div className="itch-state__actions">
            <Button variant="secondary" onClick={goBack} leftIcon={<ArrowLeft size={15} />}>
              {t("common.back")}
            </Button>
            <Button onClick={() => setNonce((value) => value + 1)} leftIcon={<RefreshCw size={15} />}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const price = formatItchPrice(detail.price, t("deals.freePrice"));
  const showOriginal =
    detail.originalPrice !== null &&
    detail.price !== null &&
    detail.originalPrice > detail.price;

  // The hero already states the author, rating and platforms, and the tag chips
  // have their own panel — keep the facts list for what is not shown twice.
  const DUPLICATED_INFO = new Set(["author", "rating", "platforms", "tags"]);
  const infoRows = detail.info.filter(
    (row) => !DUPLICATED_INFO.has(row.label.toLowerCase()),
  );

  return (
    <div className="itch-page page">
      <div
        className="itch-hero"
        style={
          detail.coverUrl
            ? { ["--itch-cover" as string]: `url("${detail.coverUrl}")` }
            : undefined
        }
      >
        <div className="itch-hero__scrim" aria-hidden="true" />

        <button type="button" className="itch-back" onClick={goBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t("common.back")}
        </button>

        <div className="itch-hero__body">
          <div className="itch-hero__art">
            {detail.coverUrl ? (
              <img src={detail.coverUrl} alt="" loading="eager" decoding="async" />
            ) : (
              <div className="itch-hero__art-fallback">itch.io</div>
            )}
          </div>

          <div className="itch-hero__info">
            <div className="itch-hero__badges">
              <span className="itch-badge itch-badge--brand">itch.io</span>
              {detail.playableInBrowser && (
                <span className="itch-badge itch-badge--play">
                  <Gamepad2 size={11} aria-hidden="true" />
                  {t("itch.playableInApp")}
                </span>
              )}
              {detail.onSale && (
                <span className="itch-badge itch-badge--sale">-{detail.discountPercent}%</span>
              )}
              {detail.status && <span className="itch-badge">{detail.status}</span>}
            </div>

            <h1 className="itch-hero__title">{detail.title}</h1>

            <p className="itch-hero__author">
              {t("itch.by")}{" "}
              <button type="button" onClick={() => openExternal(detail.authorUrl)}>
                {detail.author || detail.authorUrl}
              </button>
            </p>

            <div className="itch-hero__meta">
              {detail.rating !== null && (
                <span className="itch-rating" title={`${detail.rating} / 5`}>
                  <Star size={13} fill="currentColor" aria-hidden="true" />
                  {detail.rating.toFixed(1)}
                  {detail.ratingCount !== null && (
                    <em>{t("itch.ratings", { count: formatNumber(detail.ratingCount, language) })}</em>
                  )}
                </span>
              )}
              {detail.updated && (
                <span className="itch-hero__meta-item">
                  {t("itch.updated", { when: detail.updated })}
                </span>
              )}
              {detail.platforms.length > 0 && (
                <span className="itch-hero__meta-item">{detail.platforms.join(" · ")}</span>
              )}
            </div>

            <div className="itch-hero__price">
              <span className="itch-hero__price-value">{price}</span>
              {showOriginal && (
                <span className="itch-hero__price-old">
                  {formatItchPrice(detail.originalPrice, t("deals.freePrice"))}
                </span>
              )}
            </div>

            <div className="itch-hero__actions">
              {detail.playUrl ? (
                <Button
                  size="lg"
                  isLoading={playing}
                  leftIcon={<Gamepad2 size={17} />}
                  onClick={playInApp}
                >
                  {t("itch.playInApp")}
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="secondary"
                  leftIcon={<ExternalLink size={16} />}
                  onClick={() => openExternal(detail.purchaseUrl ?? detail.url)}
                >
                  {detail.price === null ? t("itch.openOnItch") : t("itch.buyOnItch")}
                </Button>
              )}

              {detail.playUrl && (
                <Button
                  variant="secondary"
                  size="lg"
                  leftIcon={<ExternalLink size={16} />}
                  onClick={() => openExternal(detail.url)}
                >
                  {t("itch.openOnItch")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="itch-layout">
        <div className="itch-main">
          {detail.screenshots.length > 0 && (
            <section className="itch-section">
              <h2 className="itch-section__title">{t("itch.screenshots")}</h2>
              <div className="itch-shots">
                {detail.screenshots.map((shot) => (
                  <button
                    key={shot}
                    type="button"
                    className="itch-shot"
                    onClick={() => openExternal(shot)}
                    aria-label={t("itch.openScreenshot")}
                    title={t("itch.openScreenshot")}
                  >
                    <img src={shot} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {detail.trailerUrl && (
            <section className="itch-section">
              <h2 className="itch-section__title">{t("itch.trailer")}</h2>
              <div className="itch-trailer">
                <iframe
                  src={detail.trailerUrl}
                  title={detail.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </section>
          )}

          {detail.descriptionHtml && (
            <section className="itch-section">
              <h2 className="itch-section__title">{t("itch.about")}</h2>
              {/* Third-party HTML: allowlist-sanitised before injection. */}
              <div
                className="itch-description"
                dangerouslySetInnerHTML={{
                  __html: sanitizeNewsHtml(detail.descriptionHtml),
                }}
              />
            </section>
          )}
        </div>

        <aside className="itch-side">
          <section className="itch-panel">
            <h2 className="itch-panel__title">{t("itch.details")}</h2>
            <dl className="itch-info">
              {infoRows.map((row) => (
                <div className="itch-info__row" key={`${row.label}-${row.value}`}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {detail.uploads.length > 0 && (
            <section className="itch-panel">
              <h2 className="itch-panel__title">{t("itch.downloads")}</h2>
              <p className="itch-panel__hint">{t("itch.downloadsHint")}</p>
              <ul className="itch-uploads">
                {detail.uploads.map((upload) => (
                  <li className="itch-upload" key={upload.id}>
                    <div className="itch-upload__info">
                      <span className="itch-upload__name" title={upload.name}>
                        {upload.name}
                      </span>
                      <span className="itch-upload__meta">
                        {[upload.size, upload.platforms.join(" · ")]
                          .filter(Boolean)
                          .join(" — ")}
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={downloading === upload.id}
                      leftIcon={<Download size={14} />}
                      onClick={() => downloadUpload(upload)}
                    >
                      {t("itch.download")}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.tags.length > 0 && (
            <section className="itch-panel">
              <h2 className="itch-panel__title">{t("itch.tags")}</h2>
              <div className="itch-tags">
                {detail.tags.map((tag) => (
                  <span className="itch-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
