import { useState } from "react";

/**
 * A small, square thumbnail for a game with an image-resolution chain that
 * mirrors the main app's SidebarGameItem: iconUrl → coverArtUrl (with a
 * Steam-CDN fallback chain) → letter placeholder on a stable hash-derived tint.
 */
export function GameThumbnail({
  iconUrl,
  coverArtUrl,
  steamAppId,
  name,
  className,
}: {
  iconUrl?: string | null;
  coverArtUrl?: string | null;
  steamAppId?: number | null;
  name: string;
  className?: string;
}) {
  const [iconError, setIconError] = useState(false);
  const [coverExhausted, setCoverExhausted] = useState(false);

  if (iconUrl && !iconError) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className={className}
        onError={() => setIconError(true)}
      />
    );
  }

  if (coverArtUrl && !coverExhausted) {
    return (
      <img
        src={coverArtUrl}
        alt={name}
        className={className}
        onError={(e) => {
          const img = e.currentTarget;
          if (steamAppId) {
            if (img.src.includes("library_600x900_2x")) {
              img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/library_600x900.jpg`;
              return;
            }
            if (img.src.includes("library_600x900")) {
              img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;
              return;
            }
          }
          setCoverExhausted(true);
        }}
      />
    );
  }

  const trimmed = (name || "").trim();
  const letter = trimmed.charAt(0).toUpperCase() || "?";
  const gradientIndex = hashStringToIndex(trimmed || "?", GRADIENT_SLOTS);

  return (
    <div
      className={
        (className || "") +
        " game-thumbnail__placeholder" +
        ` game-thumbnail__placeholder--g${gradientIndex}`
      }
      aria-label={name}
      role="img"
    >
      <span className="game-thumbnail__letter">{letter}</span>
    </div>
  );
}

const GRADIENT_SLOTS = 8;

function hashStringToIndex(str: string, max: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % max;
}
