import { useState } from "react";
import { FolderOpen, Gamepad2 } from "lucide-react";
import { safeArtworkUrl, thumbVariantUrl } from "../../../utils/artworkUrl";
import { isVideoPath } from "./mediaUtils";
import { useMediaFallbackSrc } from "./useMediaFallbackSrc";
import type { Game, MediaFile } from "../statsTypes";

interface AlbumCoverProps {
  /** Library match resolved from the current games list (never the cached copy). */
  game?: Game;
  /** Cover stored in the scan cache — used only when no library match exists. */
  cachedCoverUrl?: string;
  /** Album media, newest first. Used as the artwork fallback. */
  media: MediaFile[];
  isCustom: boolean;
}

/** Capture-image or paused-video-frame fallback for albums without artwork. */
function CaptureCover({ media, isCustom }: { media: MediaFile; isCustom: boolean }) {
  const { src, failed, handleError } = useMediaFallbackSrc(media.path);
  const video = isVideoPath(media.path);

  if (failed) {
    return isCustom ? (
      <FolderOpen size={24} aria-hidden="true" />
    ) : (
      <Gamepad2 size={24} aria-hidden="true" />
    );
  }

  return video ? (
    <video
      src={src}
      muted
      playsInline
      preload="metadata"
      onError={handleError}
      onLoadedMetadata={(event) => {
        if (event.currentTarget.currentTime === 0) {
          event.currentTarget.currentTime = 0.1;
        }
      }}
    />
  ) : (
    <img src={src} alt="" loading="lazy" onError={handleError} />
  );
}

/**
 * Album artwork with a guaranteed fallback chain:
 * library cover → cached cover → newest capture image → clip frame → glyph.
 *
 * Covers are resolved from the live games list by the caller, because the
 * scan cache can hold a cover from before the library finished hydrating.
 */
export function AlbumCover({ game, cachedCoverUrl, media, isCustom }: AlbumCoverProps) {
  const [artFailed, setArtFailed] = useState(false);
  const artwork = thumbVariantUrl(safeArtworkUrl(game?.coverArtUrl ?? cachedCoverUrl));

  if (artwork && !artFailed) {
    return <img src={artwork} alt="" loading="lazy" onError={() => setArtFailed(true)} />;
  }

  const image = media.find((file) => !isVideoPath(file.path));
  const clip = media.find((file) => isVideoPath(file.path));
  const fallback = image ?? clip;

  if (fallback) {
    return <CaptureCover media={fallback} isCustom={isCustom} />;
  }

  return isCustom ? (
    <FolderOpen size={24} aria-hidden="true" />
  ) : (
    <Gamepad2 size={24} aria-hidden="true" />
  );
}
