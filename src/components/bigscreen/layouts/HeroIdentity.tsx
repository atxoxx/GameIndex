// Hero identity: the game's transparent logo when one exists, with the
// plain title as a safe fallback. Every layout uses it so a broken logo
// can never hide the game's name.

import { useEffect, useState } from "react";
import type { Game } from "../../../types/game";
import { gameDisplayName } from "../../../types/game";

export default function HeroIdentity({
  game,
  className,
}: {
  game: Game;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const logoUrl = game.logoUrl;

  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  const title = gameDisplayName(game);

  if (logoUrl && !failed) {
    return (
      <img
        className={`bst-hero-logo${className ? ` ${className}` : ""}`}
        src={logoUrl}
        alt={title}
        onError={() => setFailed(true)}
        decoding="async"
      />
    );
  }

  return (
    <h1 className={`bst-hero-title${className ? ` ${className}` : ""}`}>
      {title}
    </h1>
  );
}
