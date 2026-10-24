import { useEffect, useState } from "react";
import type { Game } from "../../types/game";

interface SavesCoverProps {
  game?: Game | null;
  name: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Square cover thumbnail with a first-letter fallback.
 *
 * Cover URLs change when the user picks new artwork, so the failure flag is
 * reset whenever the URL changes instead of staying stuck on the first error.
 */
export default function SavesCover({ game, name, size = "md" }: SavesCoverProps) {
  const cover = game?.coverArtUrl;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [cover]);

  return (
    <span className={`saves-cover saves-cover--${size}`} aria-hidden="true">
      {cover && !failed ? (
        <img src={cover} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="saves-cover__fallback">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </span>
  );
}
