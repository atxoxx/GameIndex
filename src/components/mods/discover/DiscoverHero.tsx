import { FolderOpen, Globe2, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { gameDisplayName, type Game } from "../../../types/game";
import "./mods-discover.css";

interface DiscoverHeroProps {
  game: Game | null;
  detectedCount: number;
  detecting: boolean;
  onResolve?: () => void;
  onConfigure?: () => void;
  onOpenFolder?: () => void;
}

export default function DiscoverHero({
  game,
  detectedCount,
  detecting,
  onResolve,
  onConfigure,
  onOpenFolder,
}: DiscoverHeroProps) {
  const { t } = useLanguage();

  if (!game) {
    return (
      <div className="mods-discover-hero mods-discover-hero--empty">
        <div className="mods-discover-hero-inner">
          <div className="mods-discover-hero-icon-bubble">
            <Sparkles size={28} />
          </div>
          <div className="mods-discover-hero-text">
            <h2>{t("mods.discover.welcomeTitle")}</h2>
            <p>{t("mods.discover.welcomeSubtitle")}</p>
          </div>
        </div>
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
          <div className="mods-discover-hero-eyebrow">
            <span className="mods-discover-hero-platform">{game.platform}</span>
            <span className="mods-discover-hero-detect">
              <Globe2 size={13} />
              {detecting
                ? t("mods.discover.detecting")
                : t("mods.discover.detectedCount", { count: String(detectedCount) })}
            </span>
          </div>

          <h2 className="mods-discover-hero-title">{name}</h2>

          {game.modsFolder && (
            <p className="mods-discover-hero-folder" title={game.modsFolder}>
              <span className="mods-discover-hero-folder-label">{t("mods.discover.targetFolder")}:</span>{" "}
              {game.modsFolder}
            </p>
          )}
        </div>

        <div className="mods-discover-hero-actions">
          {onOpenFolder && game.modsFolder && (
            <button
              type="button"
              className="mods-discover-hero-btn"
              onClick={onOpenFolder}
              title={t("mods.openFolder")}
            >
              <FolderOpen size={14} />
              <span>{t("mods.openLocation")}</span>
            </button>
          )}

          {onResolve && (
            <button
              type="button"
              className="mods-discover-hero-btn"
              onClick={onResolve}
              disabled={detecting}
              title={t("mods.discover.detectSources")}
            >
              <RefreshCw size={14} className={detecting ? "spinning" : undefined} />
              <span>{detecting ? t("mods.discover.detecting") : t("mods.discover.detectSources")}</span>
            </button>
          )}

          {onConfigure && (
            <button
              type="button"
              className="mods-discover-hero-btn"
              onClick={onConfigure}
              title={t("mods.discover.manageSources")}
            >
              <Settings2 size={14} />
              <span>{t("mods.discover.manageSources")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
