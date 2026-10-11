import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Camera,
  FolderOpen,
  Maximize2,
  Copy,
  Check,
  Image as ImageIcon,
  Loader2,
  X,
  Trash2,
} from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useOptionalGames } from "../../../context/GameContext";
import { Card, Button } from "../../ui";

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

export default function ScreenshotsWidget() {
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
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);

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
        <span className="overlay-widget__icon" aria-hidden>
          <Camera />
        </span>
        <h3 className="overlay-widget__title">{t("overlay.widget.captures")}</h3>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCapture}
            disabled={isCapturing}
          >
            <Camera size={14} />
            <span>{t("overlay.action.screenshot")}</span>
          </Button>
        </div>
      ) : (
        <div className="overlay-screenshots-grid">
          {recentScreenshots.map((path) => {
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

      {/* In-overlay full preview lightbox */}
      {previewPath && (
        <div
          className="overlay-screenshot-lightbox"
          onClick={() => setPreviewPath(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="overlay-screenshot-lightbox__content"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="overlay-screenshot-lightbox__head">
              <span className="overlay-screenshot-lightbox__title">
                {previewPath.split(/[/\\]/).pop()}
              </span>
              <div className="overlay-screenshot-lightbox__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(previewPath)}
                  title={t("overlay.screenshot.copied")}
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
                >
                  <FolderOpen size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="overlay-btn-danger"
                  onClick={() => void handleDelete(previewPath)}
                  title={t("overlay.screenshot.delete")}
                >
                  <Trash2 size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewPath(null)}
                  aria-label={t("overlay.screenshot.close")}
                >
                  <X size={16} />
                </Button>
              </div>
            </header>
            <div className="overlay-screenshot-lightbox__image-wrap">
              <CaptureImage
                path={previewPath}
                alt="Screenshot Full Preview"
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
