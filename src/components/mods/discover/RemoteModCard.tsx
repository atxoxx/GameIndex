// One remote mod result card.

import { useState } from "react";
import { Download, ExternalLink, ThumbsUp } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import { formatCount, formatRemoteDate, sourceLabel } from "./format";
import "./mods-discover.css";

interface RemoteModCardProps {
  mod: RemoteModSummary;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
}

export default function RemoteModCard({ mod, onOpen, onOpenExternal }: RemoteModCardProps) {
  const { t } = useLanguage();
  const [broken, setBroken] = useState(false);
  const updated = formatRemoteDate(mod.updatedAt);

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
          {updated && (
            <span className="mods-discover-card-updated">
              {t("mods.discover.updated", { date: updated })}
            </span>
          )}
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
