// One remote mod result card.

import { useState } from "react";
import { Check, Download, ExternalLink, ThumbsUp } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import { formatCount, relativeTime, sourceLabel } from "./format";
import "./mods-discover.css";

interface RemoteModCardProps {
  mod: RemoteModSummary;
  installed?: boolean;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
}

export default function RemoteModCard({
  mod,
  installed,
  onOpen,
  onOpenExternal,
}: RemoteModCardProps) {
  const { t, language } = useLanguage();
  const [broken, setBroken] = useState(false);
  const updated = relativeTime(mod.updatedAt, language);

  return (
    <div className="mods-discover-card">
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
          <span className="mods-discover-card-source">{sourceLabel(mod.source)}</span>
          {installed && (
            <span className="mods-discover-card-installed">
              <Check size={11} /> {t("mods.discover.installedBadge")}
            </span>
          )}
        </div>
        <div className="mods-discover-card-body">
          <span className="mods-discover-card-name">{mod.name}</span>
          {mod.author && <span className="mods-discover-card-author">{mod.author}</span>}
          {mod.summary && <p className="mods-discover-card-summary">{mod.summary}</p>}
          <div className="mods-discover-card-meta">
            {mod.downloads != null && (
              <span title={t("mods.discover.downloads")}>
                <Download size={12} /> {formatCount(mod.downloads)}
              </span>
            )}
            {mod.endorsements != null && (
              <span title={t("mods.discover.endorsements")}>
                <ThumbsUp size={12} /> {formatCount(mod.endorsements)}
              </span>
            )}
            {mod.version && <span className="mods-discover-card-version">v{mod.version}</span>}
          </div>
          <div className="mods-discover-card-foot">
            {mod.category && (
              <span className="mods-discover-card-category">{mod.category}</span>
            )}
            {updated && (
              <span className="mods-discover-card-updated">
                {t("mods.discover.updated", { date: updated })}
              </span>
            )}
          </div>
        </div>
      </button>
      <button
        type="button"
        className="mods-discover-card-external"
        onClick={() => onOpenExternal(mod)}
        title={t("mods.discover.openPage")}
        aria-label={t("mods.discover.openPage")}
      >
        <ExternalLink size={14} />
      </button>
    </div>
  );
}
