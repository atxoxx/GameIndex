import { Camera, Star, Trash2 } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { fileName, isVideoPath } from "./mediaUtils";
import { useMediaFallbackSrc } from "./useMediaFallbackSrc";
import type { MediaFile } from "../statsTypes";

interface MediaThumbProps {
  media: MediaFile;
  /** Accessible name for the tile. */
  label: string;
  onOpen: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (path: string) => void;
  /** Permanent delete, offered on hover with a confirmation upstream. */
  onDelete?: (media: MediaFile) => void;
  /** Draw the game name over the bottom of the tile. */
  gameName?: string;
}

/**
 * One capture tile: image or muted video preview, clip badge, optional
 * favorite toggle. Shared by the album wall and the Overview digest.
 */
export function MediaThumb({
  media,
  label,
  onOpen,
  isFavorite = false,
  onToggleFavorite,
  onDelete,
  gameName,
}: MediaThumbProps) {
  const { t } = useLanguage();
  const { src, failed, handleError } = useMediaFallbackSrc(media.path);
  const isVideo = isVideoPath(media.path);

  return (
    <div
      className="gallery-thumb"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {!failed ? (
        isVideo ? (
          <video
            src={src}
            muted
            preload="metadata"
            onError={handleError}
            onLoadedMetadata={(event) => {
              // Nudge off the first frame so the tile isn't black.
              if (event.currentTarget.currentTime === 0) {
                event.currentTarget.currentTime = 0.1;
              }
            }}
          />
        ) : (
          <img src={src} alt="" loading="lazy" onError={handleError} />
        )
      ) : (
        <span className="gallery-thumb__fallback">
          <Camera size={16} aria-hidden="true" />
          <span>{fileName(media.path)}</span>
        </span>
      )}

      {isVideo && <span className="gallery-thumb__clip">▶ CLIP</span>}

      {gameName && (
        <span className="gallery-thumb__game" aria-hidden="true">
          {gameName}
        </span>
      )}

      {onToggleFavorite && (
        <button
          type="button"
          className={`gallery-thumb__fav${isFavorite ? " is-active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(media.path);
          }}
          aria-label={isFavorite ? t("community.removeFavorite") : t("community.addFavorite")}
          title={isFavorite ? t("community.removeFavorite") : t("community.addFavorite")}
        >
          <Star size={13} fill={isFavorite ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="gallery-thumb__delete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(media);
          }}
          aria-label={t("profile.deleteCapture")}
          title={t("profile.deleteCapture")}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
