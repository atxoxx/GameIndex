import { Check, Download, ExternalLink, Heart, ThumbsUp } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import { formatCount, relativeTime, sourceLabel } from "./format";
import "./mods-discover.css";

interface RemoteModCompactRowProps {
  mod: RemoteModSummary;
  installed?: boolean;
  isBookmarked?: boolean;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
  onToggleBookmark?: (mod: RemoteModSummary) => void;
  onQuickInstall?: (mod: RemoteModSummary) => void;
}

export default function RemoteModCompactRow({
  mod,
  installed,
  isBookmarked,
  onOpen,
  onOpenExternal,
  onToggleBookmark,
  onQuickInstall,
}: RemoteModCompactRowProps) {
  const { t, language } = useLanguage();
  const updated = relativeTime(mod.updatedAt, language);

  return (
    <div className={`mods-discover-compact-row ${installed ? "is-installed" : ""}`}>
      <button
        type="button"
        className="mods-discover-compact-main"
        onClick={() => onOpen(mod)}
        title={mod.name}
      >
        <span className={`mods-discover-compact-source source-${mod.source}`}>
          {sourceLabel(mod.source)}
        </span>

        <span className="mods-discover-compact-name">{mod.name}</span>

        {installed && (
          <span className="mods-discover-compact-badge" title={t("mods.discover.installedBadge")}>
            <Check size={11} /> {t("mods.discover.installedBadge")}
          </span>
        )}

        {mod.author && (
          <span className="mods-discover-compact-author">
            {mod.author}
          </span>
        )}

        {mod.category && (
          <span className="mods-discover-compact-category">{mod.category}</span>
        )}

        <div className="mods-discover-compact-stats">
          {mod.downloads != null && (
            <span title={t("mods.discover.downloads")} className="mods-discover-compact-stat">
              <Download size={11} /> {formatCount(mod.downloads)}
            </span>
          )}
          {mod.endorsements != null && (
            <span title={t("mods.discover.endorsements")} className="mods-discover-compact-stat">
              <ThumbsUp size={11} /> {formatCount(mod.endorsements)}
            </span>
          )}
        </div>

        {updated && (
          <span className="mods-discover-compact-updated">
            {updated}
          </span>
        )}
      </button>

      <div className="mods-discover-compact-actions">
        {onQuickInstall && !installed && (
          <button
            type="button"
            className="mods-discover-compact-btn mods-discover-compact-btn--install"
            onClick={() => onQuickInstall(mod)}
            title={t("mods.discover.quickInstall")}
            aria-label={t("mods.discover.quickInstall")}
          >
            <Download size={12} />
          </button>
        )}

        {onToggleBookmark && (
          <button
            type="button"
            className={`mods-discover-compact-btn ${isBookmarked ? "is-bookmarked" : ""}`}
            onClick={() => onToggleBookmark(mod)}
            title={isBookmarked ? t("mods.discover.removeBookmark") : t("mods.discover.addBookmark")}
            aria-label={isBookmarked ? t("mods.discover.removeBookmark") : t("mods.discover.addBookmark")}
          >
            <Heart size={12} fill={isBookmarked ? "currentColor" : "none"} />
          </button>
        )}

        <button
          type="button"
          className="mods-discover-compact-btn"
          onClick={() => onOpenExternal(mod)}
          title={t("mods.discover.openPage")}
          aria-label={t("mods.discover.openPage")}
        >
          <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}
