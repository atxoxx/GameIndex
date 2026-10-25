import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Maximize2,
  Copy,
  Check,
  Image as ImageIcon,
  Loader2,
  X,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useOptionalGames } from "../../../context/GameContext";
import { useIncrementalList } from "../useIncrementalList";
import { Card, Button } from "../../ui";
import type { OverlayWidgetProps } from "./types";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
};

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "image/png";
}

function useMediaFallbackSrc(path: string) {
  const [src, setSrc] = useState<string>(() => convertFileSrc(path));
  const blobUrlRef = useRef<string | null>(null);
  const inflightRef = useRef(false);
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;
    inflightRef.current = false;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setSrc(convertFileSrc(path));
    return () => {
      genRef.current = gen + 1;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [path]);

  const handleError = useCallback(() => {
    if (inflightRef.current || blobUrlRef.current) return;
    inflightRef.current = true;
    const gen = genRef.current;
    invoke<ArrayBuffer>("read_media_file", { filePath: path })
      .then((bytes) => {
        if (gen !== genRef.current) return;
        const url = URL.createObjectURL(
          new Blob([bytes], { type: mimeFromPath(path) }),
        );
        blobUrlRef.current = url;
        setSrc(url);
      })
      .catch(() => {
        /* no-op */
      });
  }, [path]);

  return { src, onError: handleError };
}

function CaptureImage({ path, alt }: { path: string; alt: string }) {
  const { src, onError } = useMediaFallbackSrc(path);
  return <img src={src} alt={alt} onError={onError} loading="lazy" />;
}

export default function ScreenshotsWidget({ bare = false }: OverlayWidgetProps) {
  const {
    session,
    recentScreenshots,
    captureScreenshot,
    deleteScreenshot,
    isCapturing,
    openScreenshotsFolder,
  } = useOverlay();
  const gameCtx = useOptionalGames();
  const games = gameCtx?.games ?? [];
  const { t } = useLanguage();

  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewZoomed, setPreviewZoomed] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);

  const previewIndex = previewPath
    ? recentScreenshots.indexOf(previewPath)
    : -1;
  const previewTotal = recentScreenshots.length;
  const previewFileName = previewPath?.split(/[/\\]/).pop() ?? "";

  const closePreview = useCallback(() => {
    setPreviewPath(null);
    setPreviewZoomed(false);
  }, []);

  const stepPreview = useCallback(
    (delta: number) => {
      if (!previewPath || previewTotal < 2) return;
      const index = previewIndex < 0 ? 0 : previewIndex;
      const next = (index + delta + previewTotal) % previewTotal;
      setPreviewPath(recentScreenshots[next]);
      setPreviewZoomed(false);
    },
    [previewPath, previewIndex, previewTotal, recentScreenshots],
  );

  // While the preview is open: Escape closes it without collapsing the panel,
  // and the arrow keys browse the rest of the gallery.
  useEffect(() => {
    if (!previewPath) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePreview();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopImmediatePropagation();
        stepPreview(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopImmediatePropagation();
        stepPreview(1);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [previewPath, closePreview, stepPreview]);

  const {
    visible: visibleScreenshots,
    hasMore,
    showMore,
  } = useIncrementalList(recentScreenshots);

  const activeGame = useMemo(() => {
    if (!session?.gameId) return null;
    return games.find((g) => g.id === session.gameId);
  }, [session, games]);

  const gameTitle = activeGame?.name ?? "GameIndex";

  const handleCapture = () => {
    void captureScreenshot(gameTitle);
  };

  const handleCopy = (path: string) => {
    navigator.clipboard?.writeText(path).then(() => {
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    });
  };

  const handleDelete = async (path: string) => {
    if (confirmDeletePath === path) {
      setConfirmDeletePath(null);
      if (previewPath === path) setPreviewPath(null);
      await deleteScreenshot(path);
    } else {
      setConfirmDeletePath(path);
      setTimeout(() => {
        setConfirmDeletePath((curr) => (curr === path ? null : curr));
      }, 3000);
    }
  };

  return (
    <Card variant="glass" className="overlay-widget overlay-screenshots-widget">
      <div className="overlay-widget__head">
        {!bare && (
          <>
            <span className="overlay-widget__icon" aria-hidden>
              <Camera />
            </span>
            <h3 className="overlay-widget__title">{t("overlay.widget.captures")}</h3>
          </>
        )}
        <span className="overlay-widget__badge">
          {t("overlay.screenshot.count", { count: recentScreenshots.length })}
        </span>
        <div className="overlay-widget__head-actions">
          <Button
            variant="ghost"
            size="sm"
            className="overlay-btn-icon"
            onClick={() => void openScreenshotsFolder()}
            title={t("overlay.screenshot.openFolder")}
            aria-label={t("overlay.screenshot.openFolder")}
          >
            <FolderOpen size={14} />
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleCapture}
            disabled={isCapturing}
            title={t("overlay.action.screenshotHint")}
            className="overlay-capture-btn"
          >
            {isCapturing ? (
              <Loader2 size={13} className="overlay-spin" />
            ) : (
              <Camera size={13} />
            )}
            <span>{t("overlay.action.screenshot")}</span>
          </Button>
        </div>
      </div>

      {recentScreenshots.length === 0 ? (
        <div className="overlay-screenshots-empty">
          <div className="overlay-screenshots-empty__icon">
            <ImageIcon size={32} />
          </div>
          <p className="overlay-screenshots-empty__text">
            {t("overlay.screenshot.noCaptures")}
          </p>
          <p className="overlay-screenshots-empty__hint">
            {t("overlay.screenshot.takeFirst")}
          </p>
          {!bare && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCapture}
              disabled={isCapturing}
            >
              <Camera size={14} />
              <span>{t("overlay.action.screenshot")}</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="overlay-screenshots-grid">
          {visibleScreenshots.map((path) => {
            const fileName = path.split(/[/\\]/).pop() ?? "Capture";
            const isConfirmingDelete = confirmDeletePath === path;
            return (
              <div key={path} className="overlay-screenshot-card">
                <div
                  className="overlay-screenshot-card__thumb"
                  onClick={() => setPreviewPath(path)}
                  role="button"
                  tabIndex={0}
                  title={fileName}
                >
                  <CaptureImage path={path} alt={fileName} />
                  <div className="overlay-screenshot-card__overlay">
                    <Maximize2 size={16} />
                  </div>
                </div>
                <div className="overlay-screenshot-card__footer">
                  <span className="overlay-screenshot-card__name" title={fileName}>
                    {fileName}
                  </span>
                  <div className="overlay-screenshot-card__actions">
                    <button
                      type="button"
                      className="overlay-btn-mini"
                      onClick={() => handleCopy(path)}
                      title={t("overlay.screenshot.copied")}
                      aria-label={t("overlay.screenshot.copied")}
                    >
                      {copiedPath === path ? (
                        <Check size={12} className="text-success" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="overlay-btn-mini"
                      onClick={() => void openScreenshotsFolder(path)}
                      title={t("overlay.screenshot.openFolder")}
                      aria-label={t("overlay.screenshot.openFolder")}
                    >
                      <FolderOpen size={12} />
                    </button>
                    <button
                      type="button"
                      className={`overlay-btn-mini overlay-btn-danger${
                        isConfirmingDelete ? " active" : ""
                      }`}
                      onClick={() => void handleDelete(path)}
                      title={
                        isConfirmingDelete
                          ? t("overlay.screenshot.delete") + "?"
                          : t("overlay.screenshot.delete")
                      }
                      aria-label={t("overlay.screenshot.delete")}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {recentScreenshots.length > 0 && hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="overlay-list-more"
          onClick={showMore}
        >
          {t("overlay.list.showMore")}
        </Button>
      )}

      {/* Full-window preview. Portalled to the body so the card's glass
          backdrop-filter can't trap the fixed layer inside the gallery. */}
      {previewPath &&
        createPortal(
          <div
            className="overlay-screenshot-lightbox"
            onClick={closePreview}
            role="dialog"
            aria-modal="true"
            aria-label={t("overlay.screenshot.fullscreen")}
            data-testid="overlay-screenshot-lightbox"
          >
            <header
              className="overlay-screenshot-lightbox__chrome"
              onClick={(event) => event.stopPropagation()}
              data-tauri-drag-region="false"
            >
              <button
                type="button"
                className="overlay-lightbox__back"
                onClick={closePreview}
                data-testid="overlay-lightbox-back"
              >
                <ArrowLeft size={14} />
                <span>{t("overlay.screenshot.back")}</span>
              </button>

              <span
                className="overlay-screenshot-lightbox__title"
                title={previewFileName}
              >
                {previewFileName}
              </span>

              <span className="overlay-lightbox__counter">
                {t("overlay.screenshot.position", {
                  current: Math.max(0, previewIndex) + 1,
                  total: previewTotal,
                })}
              </span>

              <div className="overlay-screenshot-lightbox__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(previewPath)}
                  title={t("overlay.screenshot.copied")}
                  aria-label={t("overlay.screenshot.copied")}
                >
                  {copiedPath === previewPath ? (
                    <Check size={14} className="text-success" />
                  ) : (
                    <Copy size={14} />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void openScreenshotsFolder(previewPath)}
                  title={t("overlay.screenshot.openFolder")}
                  aria-label={t("overlay.screenshot.openFolder")}
                >
                  <FolderOpen size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`overlay-btn-danger${
                    confirmDeletePath === previewPath ? " active" : ""
                  }`}
                  onClick={() => void handleDelete(previewPath)}
                  title={
                    confirmDeletePath === previewPath
                      ? t("overlay.screenshot.delete") + "?"
                      : t("overlay.screenshot.delete")
                  }
                  aria-label={t("overlay.screenshot.delete")}
                >
                  <Trash2 size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewZoomed((value) => !value)}
                  title={
                    previewZoomed
                      ? t("overlay.screenshot.zoomOut")
                      : t("overlay.screenshot.zoomIn")
                  }
                  aria-label={
                    previewZoomed
                      ? t("overlay.screenshot.zoomOut")
                      : t("overlay.screenshot.zoomIn")
                  }
                  data-testid="overlay-lightbox-zoom"
                >
                  {previewZoomed ? <ZoomOut size={14} /> : <ZoomIn size={14} />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closePreview}
                  aria-label={t("overlay.screenshot.close")}
                  data-testid="overlay-lightbox-close"
                >
                  <X size={16} />
                </Button>
              </div>
            </header>

            <div
              className="overlay-screenshot-lightbox__stage"
              onClick={closePreview}
              data-zoomed={previewZoomed ? "true" : "false"}
            >
              {previewTotal > 1 && (
                <button
                  type="button"
                  className="overlay-lightbox__nav overlay-lightbox__nav--prev"
                  aria-label={t("overlay.screenshot.previous")}
                  onClick={(event) => {
                    event.stopPropagation();
                    stepPreview(-1);
                  }}
                  data-testid="overlay-lightbox-prev"
                >
                  <ChevronLeft size={22} />
                </button>
              )}

              <div
                className="overlay-screenshot-lightbox__image-wrap"
                onClick={(event) => event.stopPropagation()}
              >
                <CaptureImage
                  path={previewPath}
                  alt={previewFileName || "Screenshot Full Preview"}
                />
              </div>

              {previewTotal > 1 && (
                <button
                  type="button"
                  className="overlay-lightbox__nav overlay-lightbox__nav--next"
                  aria-label={t("overlay.screenshot.next")}
                  onClick={(event) => {
                    event.stopPropagation();
                    stepPreview(1);
                  }}
                  data-testid="overlay-lightbox-next"
                >
                  <ChevronRight size={22} />
                </button>
              )}
            </div>

            <p className="overlay-lightbox__hint">
              {t("overlay.screenshot.hint")}
            </p>
          </div>,
          document.body,
        )}
    </Card>
  );
}
