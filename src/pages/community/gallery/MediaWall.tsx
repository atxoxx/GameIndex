import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { MediaThumb } from "./MediaThumb";
import type { MediaFile } from "../statsTypes";

const BATCH_SIZE = 24;

interface MediaWallProps {
  media: MediaFile[];
  albumLabel: string;
  favorites: Set<string>;
  onOpen: (path: string) => void;
  onToggleFavorite: (path: string) => void;
  onDelete: (media: MediaFile) => void;
}

/**
 * Album media wall with viewport-driven batching.
 *
 * Large albums are common (one Steam folder can hold hundreds of captures),
 * and every tile mounts a media element and a tooltip. Rendering the wall in
 * 24-item batches keeps the first paint light; an IntersectionObserver pulls
 * the next batch before the user reaches the end.
 */
export function MediaWall({
  media,
  albumLabel,
  favorites,
  onOpen,
  onToggleFavorite,
  onDelete,
}: MediaWallProps) {
  const { t } = useLanguage();
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= media.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + BATCH_SIZE, media.length));
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, media.length]);

  const shown = media.slice(0, visibleCount);

  return (
    <>
      <div className="profile-gallery__grid">
        {shown.map((file) => (
          <MediaThumb
            key={file.path}
            media={file}
            label={albumLabel}
            onOpen={() => onOpen(file.path)}
            isFavorite={favorites.has(file.path)}
            onToggleFavorite={onToggleFavorite}
            onDelete={onDelete}
          />
        ))}
      </div>

      {visibleCount < media.length && (
        <div className="gallery-wall__more" ref={sentinelRef}>
          <span className="gallery-wall__count">
            {t("profile.showingCount", { shown: shown.length, total: media.length })}
          </span>
          <button
            type="button"
            className="profile-link"
            onClick={() =>
              setVisibleCount((count) => Math.min(count + BATCH_SIZE, media.length))
            }
          >
            {t("profile.loadMore")}
          </button>
        </div>
      )}
    </>
  );
}
