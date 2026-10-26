import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FolderOpen, Pause, Play, Star, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { fileName, isVideoPath } from "./mediaUtils";
import { useMediaFallbackSrc } from "./useMediaFallbackSrc";
import type { MediaFile } from "../statsTypes";

export interface CaptureItem {
  media: MediaFile;
  label: string;
}

interface CaptureLightboxProps {
  items: CaptureItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  favorites: Set<string>;
  onToggleFavorite: (path: string) => void;
  /** Opens the upstream confirmation; the parent removes the item on success. */
  onDelete?: (media: MediaFile) => void;
}

function LightboxMedia({ media }: { media: MediaFile }) {
  const { src, failed, handleError } = useMediaFallbackSrc(media.path);
  const isVideo = isVideoPath(media.path);

  if (failed) {
    return (
      <div className="gallery-lightbox__failed">
        <AlertTriangle size={22} aria-hidden="true" />
        <p>{fileName(media.path)}</p>
      </div>
    );
  }

  return isVideo ? (
    <video
      key={media.path}
      src={src}
      controls
      autoPlay
      className="gallery-lightbox__video"
      onError={handleError}
    />
  ) : (
    <img
      key={media.path}
      src={src}
      alt=""
      className="gallery-lightbox__image"
      decoding="async"
      onError={handleError}
    />
  );
}

function CarouselThumb({
  media,
  active,
  onClick,
}: {
  media: MediaFile;
  active: boolean;
  onClick: () => void;
}) {
  const { src, failed, handleError } = useMediaFallbackSrc(media.path);
  const isVideo = isVideoPath(media.path);
  const name = fileName(media.path);

  return (
    <button
      type="button"
      className={`gallery-lightbox__thumb${active ? " is-active" : ""}`}
      onClick={onClick}
      title={name}
      aria-label={name}
    >
      {!failed ? (
        isVideo ? (
          <video
            src={src}
            muted
            preload="metadata"
            onError={handleError}
            onLoadedMetadata={(event) => {
              // Nudge off the first frame so the thumbnail isn't black.
              if (event.currentTarget.currentTime === 0) {
                event.currentTarget.currentTime = 0.1;
              }
            }}
          />
        ) : (
          <img src={src} alt="" loading="lazy" decoding="async" onError={handleError} />
        )
      ) : (
        <span className="gallery-lightbox__thumb-fallback">▶</span>
      )}
      {isVideo && !failed && <span className="gallery-lightbox__thumb-clip">▶</span>}
    </button>
  );
}

/**
 * Fullscreen capture viewer with keyboard navigation, a slideshow and a
 * filmstrip of the surrounding album. Rendered into `document.body` so it
 * escapes the page's stacking and scroll context.
 */
export function CaptureLightbox({
  items,
  index,
  onIndexChange,
  onClose,
  favorites,
  onToggleFavorite,
  onDelete,
}: CaptureLightboxProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [slideshow, setSlideshow] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const current = items[index] ?? null;
  const total = items.length;

  const goNext = useCallback(() => {
    if (total === 0) return;
    onIndexChange((index + 1) % total);
  }, [index, total, onIndexChange]);

  const goPrev = useCallback(() => {
    if (total === 0) return;
    onIndexChange((index - 1 + total) % total);
  }, [index, total, onIndexChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") goNext();
      else if (event.key === "ArrowLeft") goPrev();
      else if (event.key === " ") {
        event.preventDefault();
        setSlideshow((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev, onClose]);

  useEffect(() => {
    if (!slideshow || total === 0) return;
    const timer = setInterval(() => {
      // Don't churn the slideshow while the app is hidden.
      if (!document.hidden) goNext();
    }, 3500);
    return () => clearInterval(timer);
  }, [slideshow, total, goNext]);

  // Keep the active filmstrip thumbnail in view.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const active = track.querySelector(".gallery-lightbox__thumb.is-active");
    active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [index]);

  if (!current) return null;

  const isFavorite = favorites.has(current.media.path);
  // A filmstrip of hundreds of thumbnails would mount hundreds of media
  // elements; keep a window around the active capture instead.
  const stripStart = Math.max(0, index - 8);
  const stripEnd = Math.min(total, index + 9);

  return createPortal(
    <div className="gallery-lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <div className="gallery-lightbox__header" onClick={(event) => event.stopPropagation()}>
        <div className="gallery-lightbox__title">
          <span className="gallery-lightbox__counter">
            {index + 1} / {total}
          </span>
          <span className="gallery-lightbox__game">{current.label}</span>
        </div>

        <div className="gallery-lightbox__actions">
          <button
            type="button"
            className={`gallery-lightbox__tool${slideshow ? " is-active" : ""}`}
            onClick={() => setSlideshow((value) => !value)}
            title={slideshow ? t("community.stopSlideshow") : t("community.startSlideshow")}
            aria-label={slideshow ? t("community.stopSlideshow") : t("community.startSlideshow")}
          >
            {slideshow ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          </button>

          <button
            type="button"
            className={`gallery-lightbox__tool${isFavorite ? " is-active" : ""}`}
            onClick={() => onToggleFavorite(current.media.path)}
            title={isFavorite ? t("community.removeFavorite") : t("community.addFavorite")}
            aria-label={isFavorite ? t("community.removeFavorite") : t("community.addFavorite")}
          >
            <Star size={16} fill={isFavorite ? "currentColor" : "none"} aria-hidden="true" />
          </button>

          {onDelete && (
            <button
              type="button"
              className="gallery-lightbox__tool is-danger"
              onClick={() => onDelete(current.media)}
              title={t("profile.deleteCapture")}
              aria-label={t("profile.deleteCapture")}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            className="gallery-lightbox__tool"
            onClick={() => {
              const folder = current.media.path.replace(/[\\/][^\\/]*$/, "");
              invoke("open_folder", { path: folder }).catch(() => {
                showToast(t("community.couldNotOpenFolder"), "error");
              });
            }}
            title={t("community.openFolder")}
            aria-label={t("community.openFolder")}
          >
            <FolderOpen size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="gallery-lightbox__tool gallery-lightbox__tool--close"
            onClick={onClose}
            title={t("community.quit")}
            aria-label={t("community.quit")}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="gallery-lightbox__main" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="gallery-lightbox__nav is-prev"
          onClick={goPrev}
          aria-label={t("community.prevImage")}
        >
          ‹
        </button>

        <div className="gallery-lightbox__stage">
          <LightboxMedia media={current.media} />
        </div>

        <button
          type="button"
          className="gallery-lightbox__nav is-next"
          onClick={goNext}
          aria-label={t("community.nextImage")}
        >
          ›
        </button>
      </div>

      {total > 1 && (
        <div className="gallery-lightbox__strip" onClick={(event) => event.stopPropagation()}>
          <div className="gallery-lightbox__track" ref={trackRef}>
            {items.slice(stripStart, stripEnd).map((item, offset) => {
              const itemIndex = stripStart + offset;
              return (
                <CarouselThumb
                  key={item.media.path}
                  media={item.media}
                  active={itemIndex === index}
                  onClick={() => onIndexChange(itemIndex)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
