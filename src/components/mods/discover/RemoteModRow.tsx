import { useState } from "react";
import { Check, Download, ExternalLink, Heart, ThumbsUp } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import { formatCount, relativeTime, sourceLabel } from "./format";
import "./mods-discover.css";

interface RemoteModRowProps {
  mod: RemoteModSummary;
  installed?: boolean;
  isBookmarked?: boolean;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
  onToggleBookmark?: (mod: RemoteModSummary) => void;
  onQuickInstall?: (mod: RemoteModSummary) => void;
}

export default function RemoteModRow({
  mod,
  installed,
  isBookmarked,
  onOpen,
  onOpenExternal,
  onToggleBookmark,
  onQuickInstall,
}: RemoteModRowProps) {
  const { t, language } = useLanguage();
  const [broken, setBroken] = useState(false);
  const updated = relativeTime(mod.updatedAt, language);

  return (
    <div className={`mods-discover-row ${installed ? "is-installed" : ""}`}>
      <button
        type="button"
        className="mods-discover-row-main"
        onClick={() => onOpen(mod)}
        title={mod.name}
      >
        <div className="mods-discover-row-thumb">
          {mod.thumbnailUrl && !broken ? (
            <img
              src={mod.thumbnailUrl}
              alt=""
              loading="lazy"
              onError={() => setBroken(true)}
            />
          ) : (
            <span className="mods-discover-card-thumb-fallback">
              {mod.name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <div className="mods-discover-row-info">
          <div className="mods-discover-row-topline">
            <span className="mods-discover-row-name">{mod.name}</span>
            {installed && (
              <span className="mods-discover-row-installed">
                <Check size={11} /> {t("mods.discover.installedBadge")}
              </span>
            )}
            <span className={`mods-discover-row-source source-${mod.source}`}>
              {sourceLabel(mod.source)}
            </span>
            {mod.category && (
              <span className="mods-discover-row-category">{mod.category}</span>
            )}
          </div>

          <div className="mods-discover-row-byline">
            {mod.author && (
              <span className="mods-discover-row-author">
                {t("mods.discover.byAuthor", { author: mod.author })}
              </span>
            )}
            {mod.version && (
              <span className="mods-discover-row-version">v{mod.version}</span>
            )}
            {updated && (
              <span className="mods-discover-row-date">
                · {t("mods.discover.updated", { date: updated })}
              </span>
            )}
          </div>

          {mod.summary && <p className="mods-discover-row-summary">{mod.summary}</p>}
        </div>

        <div className="mods-discover-row-stats">
          {mod.downloads != null && (
            <span className="mods-discover-meta-pill" title={t("mods.discover.downloads")}>
              <Download size={12} /> {formatCount(mod.downloads)}
            </span>
          )}
          {mod.endorsements != null && (
            <span className="mods-discover-meta-pill" title={t("mods.discover.endorsements")}>
              <ThumbsUp size={12} /> {formatCount(mod.endorsements)}
            </span>
          )}
        </div>
      </button>

      <div className="mods-discover-row-actions">
        {onQuickInstall && !installed && (
          <button
            type="button"
            className="mods-discover-icon-btn mods-discover-icon-btn--primary"
            onClick={() => onQuickInstall(mod)}
            title={t("mods.discover.quickInstall")}
            aria-label={t("mods.discover.quickInstall")}
          >
            <Download size={14} />
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
            <Heart size={14} fill={isBookmarked ? "currentColor" : "none"} />
          </button>
        )}

        <button
          type="button"
          className="mods-discover-icon-btn"
          onClick={() => onOpenExternal(mod)}
          title={t("mods.discover.openPage")}
          aria-label={t("mods.discover.openPage")}
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}
