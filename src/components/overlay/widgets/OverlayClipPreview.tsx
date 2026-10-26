import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FolderOpen, X } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOverlayMediaSrc } from "./useOverlayMediaSrc";

interface OverlayClipPreviewProps {
  paths: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onOpenFolder?: (path: string) => void;
}

/**
 * Quick playback for a captured clip inside the overlay.
 *
 * Muted + looping autoplay is the only autoplay WebView2 allows, so a preview
 * starts silently and the native controls take over for sound, seeking and
 * pausing. Escape closes; arrows page the list unless the video itself has
 * focus, where they belong to the player.
 */
export function OverlayClipPreview({
  paths,
  index,
  onIndexChange,
  onClose,
  onOpenFolder,
}: OverlayClipPreviewProps) {
  const { t } = useLanguage();
  const current = paths[index];
  const { src, onError, failed } = useOverlayMediaSrc(current ?? "");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (document.activeElement instanceof HTMLVideoElement) return;
      if (event.key === "ArrowRight" && paths.length > 1) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onIndexChange((index + 1) % paths.length);
      } else if (event.key === "ArrowLeft" && paths.length > 1) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onIndexChange((index - 1 + paths.length) % paths.length);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [index, paths.length, onClose, onIndexChange]);

  if (!current) return null;

  const fileName = current.split(/[/\\]/).pop() ?? "Clip";

  return createPortal(
    <div
      className="overlay-screenshot-lightbox overlay-clip-preview"
      role="dialog"
      aria-modal="true"
      aria-label={t("overlay.recording.preview")}
    >
      <header className="overlay-screenshot-lightbox__chrome">
        <button
          type="button"
          className="overlay-lightbox__back"
          onClick={onClose}
          title={t("overlay.recording.previewClose")}
          aria-label={t("overlay.recording.previewClose")}
        >
          <X size={13} aria-hidden="true" />
          {t("overlay.recording.previewClose")}
        </button>
        <span className="overlay-screenshot-lightbox__title" title={fileName}>
          {fileName}
        </span>
        <span className="overlay-lightbox__counter">
          {index + 1} / {paths.length}
        </span>
        {onOpenFolder && (
          <div className="overlay-screenshot-lightbox__actions">
            <button
              type="button"
              className="overlay-btn-mini"
              onClick={() => onOpenFolder(current)}
              title={t("overlay.recording.openFolder")}
              aria-label={t("overlay.recording.openFolder")}
            >
              <FolderOpen size={13} aria-hidden="true" />
            </button>
          </div>
        )}
      </header>

      <div className="overlay-screenshot-lightbox__stage">
        {index > 0 && (
          <button
            type="button"
            className="overlay-lightbox__nav overlay-lightbox__nav--prev"
            onClick={() => onIndexChange(index - 1)}
            aria-label={t("community.prevImage")}
          >
            ‹
          </button>
        )}

        <div className="overlay-screenshot-lightbox__image-wrap">
          {failed ? (
            <div className="overlay-clip-preview__failed">
              <AlertTriangle size={22} aria-hidden="true" />
              <p>{t("overlay.recording.previewFailed")}</p>
              {onOpenFolder && (
                <button
                  type="button"
                  className="overlay-btn-mini"
                  onClick={() => onOpenFolder(current)}
                >
                  <FolderOpen size={12} aria-hidden="true" />
                  {t("overlay.recording.openFolder")}
                </button>
              )}
            </div>
          ) : (
            <video
              key={current}
              src={src}
              className="overlay-clip-preview__video"
              controls
              autoPlay
              muted
              loop
              playsInline
              onError={onError}
            />
          )}
        </div>

        {index < paths.length - 1 && (
          <button
            type="button"
            className="overlay-lightbox__nav overlay-lightbox__nav--next"
            onClick={() => onIndexChange(index + 1)}
            aria-label={t("community.nextImage")}
          >
            ›
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
