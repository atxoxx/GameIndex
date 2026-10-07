import { useState } from "react";
import { Check, Download, ExternalLink, Heart, ThumbsUp } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import { formatCount, relativeTime, sourceLabel } from "./format";
import "./mods-discover.css";

interface RemoteModCardProps {
  mod: RemoteModSummary;
  installed?: boolean;
  isBookmarked?: boolean;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
  onToggleBookmark?: (mod: RemoteModSummary) => void;
  onQuickInstall?: (mod: RemoteModSummary) => void;
}

export default function RemoteModCard({
  mod,
  installed,
  isBookmarked,
  onOpen,
  onOpenExternal,
  onToggleBookmark,
  onQuickInstall,
}: RemoteModCardProps) {
  const { t, language } = useLanguage();
  const [broken, setBroken] = useState(false);
  const updated = relativeTime(mod.updatedAt, language);

  return (
    <div className={`mods-discover-card ${installed ? "is-installed" : ""}`}>
      <button
        type="button"
        className="mods-discover-card-main"
        onClick={() => onOpen(mod)}
        title={mod.name}
      >
        <div className="mods-discover-card-thumb">
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

          <span className={`mods-discover-card-source source-${mod.source}`}>
            {sourceLabel(mod.source)}
          </span>

          {installed && (
            <span className="mods-discover-card-installed">
              <Check size={11} /> {t("mods.discover.installedBadge")}
            </span>
          )}
        </div>

        <div className="mods-discover-card-body">
          <span className="mods-discover-card-name" title={mod.name}>
            {mod.name}
          </span>

          {mod.author && (
            <span className="mods-discover-card-author">
              {t("mods.discover.byAuthor", { author: mod.author })}
            </span>
          )}

          {mod.summary && <p className="mods-discover-card-summary">{mod.summary}</p>}

          <div className="mods-discover-card-meta">
            {mod.downloads != null && (
              <span title={t("mods.discover.downloads")} className="mods-discover-meta-pill">
                <Download size={11} /> {formatCount(mod.downloads)}
              </span>
            )}
            {mod.endorsements != null && (
              <span title={t("mods.discover.endorsements")} className="mods-discover-meta-pill">
                <ThumbsUp size={11} /> {formatCount(mod.endorsements)}
              </span>
            )}
            {mod.version && (
              <span className="mods-discover-card-version">v{mod.version}</span>
            )}
          </div>

          <div className="mods-discover-card-foot">
            {mod.category ? (
              <span className="mods-discover-card-category">{mod.category}</span>
            ) : <span />}

            {updated && (
              <span className="mods-discover-card-updated">
                {t("mods.discover.updated", { date: updated })}
              </span>
            )}
          </div>
        </div>
      </button>

      <div className="mods-discover-card-actions">
        {onQuickInstall && !installed && (
          <button
            type="button"
            className="mods-discover-card-action-btn mods-discover-card-action-btn--install"
            onClick={() => onQuickInstall(mod)}
            title={t("mods.discover.quickInstall")}
            aria-label={t("mods.discover.quickInstall")}
          >
            <Download size={13} />
          </button>
        )}

        {onToggleBookmark && (
          <button
            type="button"
            className={`mods-discover-card-action-btn ${isBookmarked ? "is-bookmarked" : ""}`}
            onClick={() => onToggleBookmark(mod)}
            title={isBookmarked ? t("mods.discover.removeBookmark") : t("mods.discover.addBookmark")}
            aria-label={isBookmarked ? t("mods.discover.removeBookmark") : t("mods.discover.addBookmark")}
          >
            <Heart size={13} fill={isBookmarked ? "currentColor" : "none"} />
          </button>
        )}

        <button
          type="button"
          className="mods-discover-card-action-btn"
          onClick={() => onOpenExternal(mod)}
          title={t("mods.discover.openPage")}
          aria-label={t("mods.discover.openPage")}
        >
          <ExternalLink size={13} />
        </button>
      </div>
    </div>
  );
}
