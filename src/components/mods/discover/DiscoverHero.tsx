// Game banner for the Discover page: cover art, title and how many mod
// websites were detected for it.

import { Globe2 } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { gameDisplayName, type Game } from "../../../types/game";
import "./mods-discover.css";

interface DiscoverHeroProps {
  game: Game | null;
  detectedCount: number;
  detecting: boolean;
}

export default function DiscoverHero({ game, detectedCount, detecting }: DiscoverHeroProps) {
  const { t } = useLanguage();

  if (!game) {
    return (
      <div className="mods-discover-hero mods-discover-hero--empty">
        <Globe2 size={22} />
        <span>{t("mods.discover.noGame")}</span>
      </div>
    );
  }

  const name = gameDisplayName(game);
  const art = game.bannerUrl || game.coverArtUrl;

  return (
    <div className="mods-discover-hero">
      {art && (
        <div
          className="mods-discover-hero-bg"
          style={{ backgroundImage: `url(${art})` }}
          aria-hidden="true"
        />
      )}
      <div className="mods-discover-hero-scrim" aria-hidden="true" />
      <div className="mods-discover-hero-inner">
        <div className="mods-discover-hero-cover">
          {game.coverArtUrl ? (
            <img src={game.coverArtUrl} alt="" loading="lazy" />
          ) : (
            <span>{name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="mods-discover-hero-text">
          <h2>{name}</h2>
          <div className="mods-discover-hero-meta">
            <span className="mods-discover-hero-platform">{game.platform}</span>
            <span className="mods-discover-hero-detect">
              <Globe2 size={13} />
              {detecting
                ? t("mods.discover.detecting")
                : t("mods.discover.detectedCount", { count: String(detectedCount) })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
