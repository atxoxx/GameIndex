import { useState } from "react";
import { Download, ExternalLink, Heart, Sparkles, ThumbsUp } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import { formatCount, relativeTime, sourceLabel } from "./format";
import "./mods-discover.css";

interface DiscoverSpotlightProps {
  mod: RemoteModSummary;
  installed?: boolean;
  isBookmarked?: boolean;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
  onToggleBookmark?: (mod: RemoteModSummary) => void;
  onQuickInstall?: (mod: RemoteModSummary) => void;
}

export default function DiscoverSpotlight({
  mod,
  installed,
  isBookmarked,
  onOpen,
  onOpenExternal,
  onToggleBookmark,
  onQuickInstall,
}: DiscoverSpotlightProps) {
  const { t, language } = useLanguage();
  const [broken, setBroken] = useState(false);
  const updated = relativeTime(mod.updatedAt, language);

  return (
    <div className="mods-discover-spotlight" role="region" aria-label={t("mods.discover.spotlightTitle")}>
      {mod.thumbnailUrl && !broken && (
        <div
          className="mods-discover-spotlight-bg"
          style={{ backgroundImage: `url(${mod.thumbnailUrl})` }}
          aria-hidden="true"
        />
      )}
      <div className="mods-discover-spotlight-scrim" aria-hidden="true" />

      <div className="mods-discover-spotlight-content">
        <div className="mods-discover-spotlight-badge-row">
          <span className="mods-discover-spotlight-tag">
            <Sparkles size={12} /> {t("mods.discover.spotlightTag")}
          </span>
          <span className={`mods-discover-spotlight-source source-${mod.source}`}>
            {sourceLabel(mod.source)}
          </span>
          {installed && (
            <span className="mods-discover-badge-installed">
              {t("mods.discover.installedBadge")}
            </span>
          )}
        </div>

        <h3 className="mods-discover-spotlight-title">{mod.name}</h3>

        {mod.author && (
          <p className="mods-discover-spotlight-author">
            {t("mods.discover.byAuthor", { author: mod.author })}
          </p>
        )}

        {mod.summary && (
          <p className="mods-discover-spotlight-summary">{mod.summary}</p>
        )}

        <div className="mods-discover-spotlight-meta">
          {mod.downloads != null && (
            <span className="mods-discover-meta-item" title={t("mods.discover.downloads")}>
              <Download size={13} /> {formatCount(mod.downloads)}
            </span>
          )}
          {mod.endorsements != null && (
            <span className="mods-discover-meta-item" title={t("mods.discover.endorsements")}>
              <ThumbsUp size={13} /> {formatCount(mod.endorsements)}
            </span>
          )}
          {mod.category && (
            <span className="mods-discover-spotlight-category">{mod.category}</span>
          )}
          {updated && (
            <span className="mods-discover-spotlight-updated">
              {t("mods.discover.updated", { date: updated })}
            </span>
          )}
        </div>

        <div className="mods-discover-spotlight-actions">
          <button
            type="button"
            className="mods-discover-btn mods-discover-btn--primary"
            onClick={() => onOpen(mod)}
          >
            {t("mods.discover.viewDetails")}
          </button>

          {onQuickInstall && !installed && (
            <button
              type="button"
              className="mods-discover-btn mods-discover-btn--secondary"
              onClick={() => onQuickInstall(mod)}
            >
              <Download size={14} />
              {t("mods.discover.quickInstall")}
            </button>
          )}

          {onToggleBookmark && (
            <button
              type="button"
              className={`mods-discover-icon-btn ${isBookmarked ? "is-bookmarked" : ""}`}
              onClick={() => onToggleBookmark(mod)}
              title={isBookmarked ? t("mods.discover.removeBookmark") : t("mods.discover.addBookmark")}
              aria-label={isBookmarked ? t("mods.discover.removeBookmark") : t("mods.discover.addBookmark")}
            >
              <Heart size={15} fill={isBookmarked ? "currentColor" : "none"} />
            </button>
          )}

          <button
            type="button"
            className="mods-discover-icon-btn"
            onClick={() => onOpenExternal(mod)}
            title={t("mods.discover.openPage")}
            aria-label={t("mods.discover.openPage")}
          >
            <ExternalLink size={15} />
          </button>
        </div>
      </div>

      <div className="mods-discover-spotlight-media" onClick={() => onOpen(mod)}>
        {mod.thumbnailUrl && !broken ? (
          <img
            src={mod.thumbnailUrl}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="mods-discover-thumb-fallback">
            <span>{mod.name.slice(0, 2).toUpperCase()}</span>
          </div>
        )}
      </div>
    </div>
  );
}
